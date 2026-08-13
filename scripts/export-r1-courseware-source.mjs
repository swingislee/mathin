import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  assembleCoursewareSourceCapture,
  hashStorageByteStream,
  parseCoursewareSourceCaptureNdjson,
  validateCoursewareSourceCapture,
  verifyH5PackageStorage,
} from "./lib/r1-courseware-source-export.mjs";
import { textFileSha256 } from "./lib/text-hash.mjs";
import {
  buildCoursewareSourcePlan,
  canonicalJson,
  loadCoursewareSourceContext,
} from "./plan-r1-courseware-source.mjs";

const MANIFEST_VERSION = "mathin-r1-courseware-source-manifest-v4";
const APPROVED_COPY_ATTESTATION = "approved-read-only-copy";
const CAPTURE_LIMIT_BYTES = 512 * 1024 * 1024;
const MANIFEST_LIMIT_BYTES = 4 * 1024 * 1024;
const STORAGE_LIST_LIMIT = 20_000;
const OUTPUT_NAME = /^[a-z0-9][a-z0-9._-]{2,79}$/;
const SSH_TARGET = /^(?:[a-z0-9._-]+@)?[a-z0-9._-]+$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const CHILD_ENV_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP", "USERPROFILE", "HOME", "LANG", "LC_ALL", "TMPDIR"];

function fail(message) {
  throw new Error(`R1 courseware source exporter: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sanitizeError(value) {
  return String(value ?? "")
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[redacted-endpoint]")
    .replace(/(?:authorization|apikey|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(-4096);
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function relativeArtifactPath(outputName, name) {
  return `${outputName}/${name}`.replaceAll("\\", "/");
}

function ndjson(rows) {
  return rows.map((row) => canonicalJson(row)).join("\n") + "\n";
}

export function parseCoursewareSourceExportArgs(argv) {
  const result = { artifactRoot: null, outputName: null, provenance: null, exportedAt: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (["--artifact-root", "--output-name", "--provenance", "--exported-at"].includes(argument)) {
      const value = argv[index + 1];
      assert(value && !value.startsWith("--"), `${argument} requires a value`);
      index += 1;
      if (argument === "--artifact-root") result.artifactRoot = value;
      if (argument === "--output-name") result.outputName = value;
      if (argument === "--provenance") result.provenance = value;
      if (argument === "--exported-at") result.exportedAt = value;
      continue;
    }
    fail(`unsupported argument ${argument}`);
  }
  assert(result.artifactRoot, "--artifact-root is required");
  assert(result.outputName && OUTPUT_NAME.test(result.outputName), "--output-name must be a 3-80 character lowercase local name");
  assert(
    result.provenance
      && !path.isAbsolute(result.provenance)
      && !result.provenance.includes("\\")
      && result.provenance.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
      && !/^[a-z][a-z0-9+.-]*:/i.test(result.provenance),
    "--provenance must be a safe path relative to artifact root",
  );
  if (result.exportedAt !== null) assert(ISO_UTC.test(result.exportedAt), "--exported-at must be an ISO UTC date-time");
  return result;
}

/**
 * @param {string} databaseUrl
 * @param {Record<string, string | undefined>} [baseEnvironment]
 */
export function libpqEnvironmentFromDatabaseUrl(databaseUrl, baseEnvironment = process.env) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is invalid");
  }
  assert(["postgres:", "postgresql:"].includes(parsed.protocol), "DATABASE_URL must use postgres or postgresql");
  assert(parsed.hostname && parsed.username, "DATABASE_URL must include host and user");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  assert(database && !database.includes("/"), "DATABASE_URL must name one database");
  const allowedQueryKeys = new Set(["sslmode"]);
  for (const key of parsed.searchParams.keys()) assert(allowedQueryKeys.has(key), `DATABASE_URL query option ${key} is unsupported`);
  const environment = Object.fromEntries(CHILD_ENV_KEYS.flatMap((key) => (
    baseEnvironment[key] === undefined ? [] : [[key, baseEnvironment[key]]]
  )));
  return {
    ...environment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
    ...(parsed.searchParams.has("sslmode") ? { PGSSLMODE: parsed.searchParams.get("sslmode") } : {}),
  };
}

function collectChildProcess(child, { input, maxBytes, label }) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => rejectOnce(new Error(`R1 courseware source exporter: ${label} timed out`)), 35 * 60 * 1000);
    timeout.unref?.();
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      reject(error);
    };
    child.on("error", () => rejectOnce(new Error(`R1 courseware source exporter: unable to start ${label}`)));
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxBytes) return rejectOnce(new Error(`R1 courseware source exporter: ${label} output exceeds ${maxBytes} bytes`));
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = sanitizeError(Buffer.concat(stderr).toString("utf8").trim());
        reject(new Error(`R1 courseware source exporter: ${label} failed (status=${code})${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/**
 * @param {{sql: string, environment?: Record<string, string | undefined>, spawnProcess?: typeof spawn}} input
 */
export async function runReadOnlyCoursewareCapture({ sql, environment = process.env, spawnProcess = spawn }) {
  assert(environment.R1_COURSEWARE_SOURCE_ENVIRONMENT === APPROVED_COPY_ATTESTATION, `R1_COURSEWARE_SOURCE_ENVIRONMENT must equal ${APPROVED_COPY_ATTESTATION}`);
  const databaseUrl = environment.DATABASE_URL;
  const sshTarget = environment.SUPABASE_DB_SSH;
  assert(Boolean(databaseUrl) !== Boolean(sshTarget), "set exactly one of DATABASE_URL or SUPABASE_DB_SSH");
  let child;
  if (sshTarget) {
    assert(SSH_TARGET.test(sshTarget) && !sshTarget.startsWith("-"), "SUPABASE_DB_SSH is invalid");
    child = spawnProcess(process.platform === "win32" ? "ssh.exe" : "ssh", [
      sshTarget,
      "docker exec -i supabase-db psql -U postgres -d postgres -X -qAt -v ON_ERROR_STOP=1",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: Object.fromEntries(CHILD_ENV_KEYS.flatMap((key) => (
        environment[key] === undefined ? [] : [[key, environment[key]]]
      ))),
    });
  } else {
    child = spawnProcess("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: libpqEnvironmentFromDatabaseUrl(databaseUrl, environment),
    });
  }
  return collectChildProcess(child, { input: sql, maxBytes: CAPTURE_LIMIT_BYTES, label: sshTarget ? "SSH read-only capture" : "psql read-only capture" });
}

function storageHeaders(key, json = false) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

function encodedStoragePath(value) {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

async function boundedResponseBytes(response, { maxBytes, label }) {
  assert(response.body, `${label} returned no byte stream`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        fail(`${label} exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function createReadOnlyStorageClient({ baseUrl, key, fetchImpl = fetch }) {
  let endpoint;
  try {
    endpoint = new URL(baseUrl);
  } catch {
    fail("NEXT_PUBLIC_SUPABASE_URL is invalid");
  }
  assert(["http:", "https:"].includes(endpoint.protocol), "NEXT_PUBLIC_SUPABASE_URL must use HTTP(S)");
  assert(!endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash, "NEXT_PUBLIC_SUPABASE_URL must not contain credentials, query, or fragment");
  assert(typeof key === "string" && key.length >= 20, "SUPABASE_SECRET_KEY is missing or invalid");
  const base = endpoint.toString().replace(/\/$/, "");
  const request = async (url, init, label) => {
    let response;
    try {
      response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(5 * 60 * 1000) });
    } catch {
      fail(`${label} request failed`);
    }
    assert(response.ok, `${label} failed with HTTP ${response.status}`);
    return response;
  };
  return {
    async openObject(bucket, objectPath) {
      const url = `${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedStoragePath(objectPath)}`;
      const response = await request(url, { method: "GET", headers: storageHeaders(key) }, `Storage read ${bucket}`);
      return response.body;
    },
    async readObject(bucket, objectPath, maxBytes = MANIFEST_LIMIT_BYTES) {
      const url = `${base}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedStoragePath(objectPath)}`;
      const response = await request(url, { method: "GET", headers: storageHeaders(key) }, `Storage read ${bucket}`);
      return boundedResponseBytes(response, { maxBytes, label: `Storage read ${bucket}` });
    },
    async listTree(bucket, rootPrefix) {
      const pending = [rootPrefix.replace(/\/$/, "")];
      const objectPaths = [];
      while (pending.length > 0) {
        const prefix = pending.shift();
        let offset = 0;
        while (true) {
          const response = await request(`${base}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
            method: "POST",
            headers: storageHeaders(key, true),
            body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
          }, `Storage list ${bucket}`);
          const bytes = await boundedResponseBytes(response, { maxBytes: MANIFEST_LIMIT_BYTES, label: `Storage list ${bucket}` });
          let rows;
          try { rows = JSON.parse(bytes.toString("utf8")); } catch { fail(`Storage list ${bucket} returned invalid JSON`); }
          assert(Array.isArray(rows), `Storage list ${bucket} must return an array`);
          for (const row of rows) {
            assert(row && typeof row.name === "string" && row.name.length > 0 && row.name !== "." && row.name !== ".." && !row.name.includes("/"), `Storage list ${bucket} returned an invalid name`);
            const childPath = `${prefix}/${row.name}`;
            if (row.id === null || row.id === undefined) pending.push(childPath);
            else objectPaths.push(childPath);
            assert(objectPaths.length + pending.length <= STORAGE_LIST_LIMIT, `Storage list ${bucket} exceeds ${STORAGE_LIST_LIMIT} entries`);
          }
          if (rows.length < 1000) break;
          offset += rows.length;
        }
      }
      return objectPaths.sort();
    },
  };
}

export function resolveCapturedMigrationHead(metaVersion, repositoryRoot = process.cwd()) {
  assert(/^\d{14}$/.test(metaVersion ?? ""), "captured migration version is invalid");
  const migrations = fs.readdirSync(path.join(repositoryRoot, "supabase", "migrations"))
    .filter((name) => name.startsWith(`${metaVersion}_`) && name.endsWith(".sql"));
  assert(migrations.length === 1, `captured migration ${metaVersion} does not map to exactly one repository migration`);
  return migrations[0].slice(0, -4);
}

async function prepareAtomicDirectory(artifactRoot, outputName) {
  const root = await realpath(path.resolve(artifactRoot));
  assert((await stat(root)).isDirectory(), "--artifact-root must be an existing directory");
  assert(!root.startsWith("\\\\") && !root.startsWith("//"), "--artifact-root must not be UNC");
  const finalDirectory = path.join(root, outputName);
  assert(isWithin(root, finalDirectory), "output directory must remain inside artifact root");
  assert(!fs.existsSync(finalDirectory), "output directory already exists");
  const stagingContainer = await mkdtemp(path.join(root, ".r1-courseware-source-"));
  const workDirectory = path.join(stagingContainer, outputName);
  await mkdir(workDirectory);
  return { root, finalDirectory, stagingContainer, workDirectory };
}

async function writeVerifiedArtifactSet({ repositoryRoot, atomic, exportedAt, captureText, provenance, assembled, h5Manifests }) {
  const outputName = path.basename(atomic.finalDirectory);
  const paths = {
    capture: "capture.ndjson",
    provenance: "reviewed-provenance.json",
    aixuexiInventory: "r1-courseware-aixuexi.ndjson",
    eSeriesInventory: "r1-courseware-e-series.ndjson",
    h5Objects: "r1-courseware-cw-h5-objects.ndjson",
    regularObjects: "r1-courseware-cw-objects.ndjson",
    manifest: "r1-courseware-source-manifest.json",
    plan: "r1-courseware-source-plan.json",
  };
  await writeFile(path.join(atomic.workDirectory, paths.capture), captureText.replace(/\r\n?/g, "\n"), "utf8");
  await writeFile(path.join(atomic.workDirectory, paths.provenance), `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  const h5Directory = path.join(atomic.workDirectory, "h5-manifests");
  await mkdir(h5Directory);
  for (const [packageHash, bytes] of h5Manifests) await writeFile(path.join(h5Directory, `${packageHash}.json`), bytes);
  const aixuexi = assembled.inventories.find((entry) => entry.courseSystem === "aixuexi-autumn").entries;
  const eSeries = assembled.inventories.find((entry) => entry.courseSystem === "e-series").entries;
  await writeFile(path.join(atomic.workDirectory, paths.aixuexiInventory), ndjson(aixuexi), "utf8");
  await writeFile(path.join(atomic.workDirectory, paths.eSeriesInventory), ndjson(eSeries), "utf8");
  const h5Resources = assembled.storageResources.filter((entry) => entry.storageBucket === "cw-h5");
  const regularResources = assembled.storageResources.filter((entry) => entry.storageBucket === "cw-objects");
  await writeFile(path.join(atomic.workDirectory, paths.h5Objects), ndjson(h5Resources), "utf8");
  await writeFile(path.join(atomic.workDirectory, paths.regularObjects), ndjson(regularResources), "utf8");
  const inventoryPath = (name) => relativeArtifactPath(outputName, name);
  const manifest = {
    $schema: "schemas/r1-courseware-source-manifest.schema.json",
    schemaVersion: MANIFEST_VERSION,
    example: false,
    mode: "plan-only",
    writesAllowed: false,
    networkAllowed: false,
    databaseConnectionAllowed: false,
    capturedFrom: {
      environment: "offline-read-only-export",
      readOnly: true,
      databaseFingerprint: assembled.databaseFingerprint,
      migrationHead: assembled.migrationHead,
      exportedAt,
    },
    inventories: [
      { courseSystem: "aixuexi-autumn", path: inventoryPath(paths.aixuexiInventory), sha256: textFileSha256(path.join(atomic.workDirectory, paths.aixuexiInventory)) },
      {
        courseSystem: "e-series",
        path: inventoryPath(paths.eSeriesInventory),
        sha256: textFileSha256(path.join(atomic.workDirectory, paths.eSeriesInventory)),
        roster: {
          path: "supabase/seed/teaching-plans.json",
          sha256: textFileSha256(path.join(repositoryRoot, "supabase", "seed", "teaching-plans.json")),
        },
      },
    ],
    storageAudits: [
      { bucket: "cw-h5", prefix: "packages/", objectsManifestPath: inventoryPath(paths.h5Objects), objectsManifestSha256: textFileSha256(path.join(atomic.workDirectory, paths.h5Objects)) },
      { bucket: "cw-objects", prefix: "sha256/", objectsManifestPath: inventoryPath(paths.regularObjects), objectsManifestSha256: textFileSha256(path.join(atomic.workDirectory, paths.regularObjects)) },
    ],
    expected: {
      courseCount: 102,
      lectureCount: 1305,
      nativeTrackCount: 1305,
      adaptedTrackCount: 1305,
      releaseCount: 2610,
      missingBindingCount: 0,
      missingResourceCount: 0,
      storageHashMismatchCount: 0,
    },
  };
  await writeFile(path.join(atomic.workDirectory, paths.manifest), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const context = loadCoursewareSourceContext({
    root: repositoryRoot,
    manifestPath: inventoryPath(paths.manifest),
    approvedArtifactRoots: [atomic.stagingContainer],
  });
  const plan = buildCoursewareSourcePlan(context);
  assert(plan.p6SourceManifestReady === true && plan.blockers.length === 0, "generated manifest did not pass the offline source planner");
  await writeFile(path.join(atomic.workDirectory, paths.plan), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return { manifest, plan, paths };
}

export async function runCoursewareSourceExport({
  argv = process.argv.slice(2),
  environment = process.env,
  repositoryRoot = process.cwd(),
  fetchImpl = fetch,
  spawnProcess = spawn,
} = {}) {
  const options = parseCoursewareSourceExportArgs(argv);
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const atomic = await prepareAtomicDirectory(options.artifactRoot, options.outputName);
  try {
    const provenanceFile = path.resolve(atomic.root, options.provenance);
    assert(isWithin(atomic.root, provenanceFile), "--provenance resolves outside artifact root");
    const provenanceRealPath = await realpath(provenanceFile);
    assert(isWithin(atomic.root, provenanceRealPath), "--provenance symlink resolves outside artifact root");
    assert((await stat(provenanceRealPath)).size <= 32 * 1024 * 1024, "--provenance exceeds 32 MiB");
    const provenance = JSON.parse(await readFile(provenanceRealPath, "utf8"));
    const sql = await readFile(path.join(repositoryRoot, "scripts", "sql", "r1-courseware-source-export.sql"), "utf8");
    const captureText = await runReadOnlyCoursewareCapture({ sql, environment, spawnProcess });
    const records = parseCoursewareSourceCaptureNdjson(captureText);
    const meta = records.find((record) => record?.recordType === "meta");
    const migrationHead = resolveCapturedMigrationHead(meta?.migrationVersion, repositoryRoot);
    const capture = validateCoursewareSourceCapture(records, { migrationHead });
    const storage = createReadOnlyStorageClient({
      baseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      key: environment.SUPABASE_SECRET_KEY,
      fetchImpl,
    });
    const resources = new Map();
    for (const page of capture.pages) {
      for (const binding of page.bindings) {
        const key = `${binding.storageBucket}\0${binding.storagePath}`;
        const resource = {
          objectSha256: binding.objectSha256,
          kind: binding.kind,
          mime: binding.mime,
          byteCount: binding.byteCount,
          storageBucket: binding.storageBucket,
          storagePath: binding.storagePath,
        };
        const prior = resources.get(key);
        assert(!prior || canonicalJson(prior) === canonicalJson(resource), `captured resource metadata drifts for ${binding.storageBucket}/${binding.storagePath}`);
        resources.set(key, resource);
      }
    }
    const h5Evidence = [];
    const h5Manifests = new Map();
    for (const binding of [...resources.values()]) {
      if (binding.kind !== "h5") {
        const stream = await storage.openObject(binding.storageBucket, binding.storagePath);
        await hashStorageByteStream(stream, {
          expectedSha256: binding.objectSha256,
          expectedByteCount: binding.byteCount,
          maxBytes: binding.byteCount,
          label: `Storage ${binding.storageBucket} object`,
        });
        continue;
      }
      const manifestStoragePath = `${binding.storagePath}/__mathin_manifest.json`;
      const manifestBytes = await storage.readObject("cw-h5", manifestStoragePath, MANIFEST_LIMIT_BYTES);
      const listedObjectPaths = await storage.listTree("cw-h5", binding.storagePath);
      const verified = await verifyH5PackageStorage({
        packageHash: binding.objectSha256,
        expectedByteCount: binding.byteCount,
        manifestBytes,
        listedObjectPaths,
        openObjectStream: (objectPath) => storage.openObject("cw-h5", objectPath),
      });
      h5Manifests.set(binding.objectSha256, manifestBytes);
      h5Evidence.push({
        objectSha256: binding.objectSha256,
        h5ManifestPath: relativeArtifactPath(options.outputName, `h5-manifests/${binding.objectSha256}.json`),
        h5ManifestSha256: verified.manifestTextSha256,
      });
    }
    const assembled = assembleCoursewareSourceCapture(records, { migrationHead, provenance, h5ManifestEvidence: h5Evidence });
    const artifact = await writeVerifiedArtifactSet({ repositoryRoot, atomic, exportedAt, captureText, provenance, assembled, h5Manifests });
    await rename(atomic.workDirectory, atomic.finalDirectory);
    await rmdir(atomic.stagingContainer);
    const finalContext = loadCoursewareSourceContext({
      root: repositoryRoot,
      manifestPath: relativeArtifactPath(options.outputName, artifact.paths.manifest),
      approvedArtifactRoots: [atomic.root],
    });
    const finalPlan = buildCoursewareSourcePlan(finalContext);
    assert(finalPlan.p6SourceManifestReady && finalPlan.blockers.length === 0, "finalized artifact failed offline verification");
    return {
      outputDirectory: atomic.finalDirectory,
      manifestSha256: textFileSha256(path.join(atomic.finalDirectory, artifact.paths.manifest)),
      contentStateSha256: finalPlan.contentStateSha256,
      planHash: finalPlan.planHash,
      counts: finalPlan.actual,
    };
  } catch (error) {
    if (isWithin(atomic.root, atomic.stagingContainer) && fs.existsSync(atomic.stagingContainer)) {
      await rm(atomic.stagingContainer, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const result = await runCoursewareSourceExport({ argv });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${sanitizeError(error?.message ?? error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) await main();
