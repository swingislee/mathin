import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { importCourseware } from "./cw-import.mjs";

function fail(message) {
  throw new Error("AIXUEXI_IMPORT_ALL: " + message);
}

function parseArgs(argv) {
  const options = {
    packageKey: "2026-gplus-sujiao-math",
    packageRoot: null,
    storeRoot: path.resolve(process.cwd(), "..", "2026-07_mofaxiao_courseware"),
    sshHost: process.env.CW_IMPORT_SSH_HOST ?? "xiaomi",
    startAt: 1,
    limit: Number.POSITIVE_INFINITY,
    dryRun: false,
    localDocker: false,
    databaseUrl: process.env.CW_IMPORT_DATABASE_URL ?? null,
    catalogVersion: null,
    catalogMap: null,
    duplicateCatalogVersion: null,
    allowProductionTarget: false,
    upgradeSourceRuntime: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--local-docker") {
      options.localDocker = true;
      continue;
    }
    if (arg === "--allow-production-target") {
      options.allowProductionTarget = true;
      continue;
    }
    if (arg === "--upgrade-source-runtime") {
      options.upgradeSourceRuntime = true;
      continue;
    }
    if (["--package-key", "--package-root", "--store-root", "--ssh-host", "--start-at", "--limit", "--database-url", "--catalog-version", "--catalog-map", "--duplicate-catalog-version"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(arg + " requires a value");
      const key = arg.slice(2).replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
      options[key] = ["--start-at", "--limit"].includes(arg) ? Number(value) : value;
      continue;
    }
    fail("unknown argument " + arg);
  }
  if (!Number.isInteger(options.startAt) || options.startAt < 1) fail("--start-at must be a positive integer");
  if (!(options.limit === Number.POSITIVE_INFINITY || Number.isInteger(options.limit) && options.limit > 0)) {
    fail("--limit must be a positive integer");
  }
  if (options.localDocker && !options.databaseUrl) fail("--database-url is required with --local-docker");
  if (!options.localDocker && options.databaseUrl) fail("--database-url is only valid with --local-docker");
  if (options.duplicateCatalogVersion && !options.catalogMap) {
    fail("--duplicate-catalog-version requires --catalog-map");
  }
  if (options.upgradeSourceRuntime && (!options.localDocker || options.allowProductionTarget)) {
    fail("--upgrade-source-runtime is restricted to the local Docker development database");
  }
  options.packageRoot ??= path.resolve(process.cwd(), ".tmp", "aixuexi-import", options.packageKey);
  return options;
}

async function catalogVersionsByProduct(options) {
  if (!options.catalogMap) return new Map();
  const plans = JSON.parse(await readFile(path.resolve(options.catalogMap), "utf8"));
  if (!Array.isArray(plans)) fail("--catalog-map must contain a JSON array");
  const result = new Map();
  for (const plan of plans) {
    if (typeof plan.productCode !== "string" || typeof plan.catalogVersion !== "string") {
      fail("--catalog-map rows require productCode and catalogVersion");
    }
    const versions = result.get(plan.productCode) ?? new Set();
    versions.add(plan.catalogVersion);
    result.set(plan.productCode, versions);
  }
  return result;
}

export function resolveCatalogVersion(lecture, options, versionsByProduct) {
  if (options.catalogVersion) return options.catalogVersion;
  if (lecture.catalogVersionSlug) return lecture.catalogVersionSlug;
  const versions = versionsByProduct.get(lecture.mathinProductCode);
  if (!versions || versions.size === 0) return null;
  if (versions.size === 1) return [...versions][0];
  if (options.duplicateCatalogVersion && versions.has(options.duplicateCatalogVersion)) {
    return options.duplicateCatalogVersion;
  }
  fail(`product ${lecture.mathinProductCode} maps to multiple catalog versions; pass --duplicate-catalog-version`);
}

export function unresolvedSourceRuntimeDrift(pages = {}) {
  return Math.max(0, (pages.baselineDrift ?? 0) - (pages.sourceRuntimeUpgraded ?? 0));
}

export async function importAll(options) {
  const lectures = (await readFile(path.join(options.packageRoot, "lectures.ndjson"), "utf8"))
    .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const selected = lectures.slice(options.startAt - 1, options.startAt - 1 + options.limit);
  const versionsByProduct = await catalogVersionsByProduct(options);
  const results = [];

  for (const [index, lecture] of selected.entries()) {
    process.stderr.write(
      "AIXUEXI_IMPORT_ALL: " + (options.startAt + index) + "/" + lectures.length
      + " · " + lecture.coursewareId + " · " + lecture.lessonName + "\n",
    );
    const args = [
      path.join(process.cwd(), "scripts", "cw-import.mjs"),
      "--package-root", options.packageRoot,
      "--store-root", options.storeRoot,
      "--courseware-id", lecture.coursewareId,
    ];
    const catalogVersion = resolveCatalogVersion(lecture, options, versionsByProduct);
    if (catalogVersion) args.push("--catalog-version", catalogVersion);
    if (options.localDocker) args.push("--local-docker", "--database-url", options.databaseUrl);
    else args.push("--ssh-host", options.sshHost);
    if (options.dryRun) args.push("--dry-run");
    if (options.allowProductionTarget) args.push("--allow-production-target");
    if (options.upgradeSourceRuntime) args.push("--upgrade-source-runtime");
    let result;
    if (options.localDocker) {
      result = await importCourseware({
        packageRoot: options.packageRoot,
        storeRoot: options.storeRoot,
        coursewareId: lecture.coursewareId,
        catalogVersion,
        dryRun: options.dryRun,
        localDocker: true,
        databaseUrl: options.databaseUrl,
        sshHost: options.sshHost,
        allowProductionTarget: false,
        upgradeSourceRuntime: options.upgradeSourceRuntime,
        quiet: true,
      });
    } else {
      const child = spawnSync(process.execPath, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        shell: false,
      });
      if (child.status !== 0) {
        process.stderr.write(child.stderr ?? "");
        fail("lecture " + lecture.coursewareId + " failed with exit code " + child.status);
      }
      result = JSON.parse(child.stdout);
    }
    results.push(result);
    process.stderr.write(
      "AIXUEXI_IMPORT_ALL: ok · pages=" + result.expected.pages
      + " · bindings=" + result.expected.usages
      + " · uploaded=" + (result.storage?.cwObjects.uploaded ?? 0)
      + "+" + (result.storage?.cwH5.uploaded ?? 0) + "\n",
    );
  }

  return {
    dryRun: options.dryRun,
    startAt: options.startAt,
    imported: results.length,
    lectures: lectures.length,
    pages: results.reduce((sum, result) => sum + result.expected.pages, 0),
    bindings: results.reduce((sum, result) => sum + result.expected.usages, 0),
    databaseConflicts: results.reduce((sum, result) => sum + (result.database?.bindings.conflicts ?? 0), 0),
    sourceRuntimeUpgraded: results.reduce(
      (sum, result) => sum + (result.database?.pages.sourceRuntimeUpgraded ?? 0),
      0,
    ),
    baselineDrift: results.reduce(
      (sum, result) => sum + unresolvedSourceRuntimeDrift(result.database?.pages),
      0,
    ),
  };
}

async function main() {
  const summary = await importAll(parseArgs(process.argv.slice(2)));
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
