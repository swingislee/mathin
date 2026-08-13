import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import {
  createReadOnlyStorageClient,
  libpqEnvironmentFromDatabaseUrl,
  parseCoursewareSourceExportArgs,
  resolveCapturedMigrationHead,
  runReadOnlyCoursewareCapture,
} from "../scripts/export-r1-courseware-source.mjs";
import { hashStorageByteStream } from "../scripts/lib/r1-courseware-source-export.mjs";

type SpawnCall = [string, string[], { shell?: unknown; env?: Record<string, string | undefined> }];

function databaseUrl(password = "password", suffix = "") {
  return ["postgresql", "://", "reader", ":", encodeURIComponent(password), "@", "db.internal", suffix, "/mathin"].join("");
}

function fakeChild(output: string, status = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.stdin.on("finish", () => {
    queueMicrotask(() => {
      if (status === 0) child.stdout.write(output);
      else child.stderr.write("database failed at https://secret.invalid?token=hidden");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", status);
    });
  });
  return child;
}

describe("R1 courseware source exporter CLI", () => {
  it("requires an explicit controlled artifact root, safe output name, and relative provenance", () => {
    expect(parseCoursewareSourceExportArgs([
      "--artifact-root", "D:/evidence",
      "--output-name", "capture-20260813",
      "--provenance", "reviewed/e-series.json",
      "--exported-at", "2026-08-13T12:00:00Z",
    ])).toEqual({
      artifactRoot: "D:/evidence",
      outputName: "capture-20260813",
      provenance: "reviewed/e-series.json",
      exportedAt: "2026-08-13T12:00:00Z",
    });
    expect(() => parseCoursewareSourceExportArgs(["--artifact-root", "D:/evidence", "--output-name", "../escape", "--provenance", "p.json"])).toThrow(/output-name/);
    expect(() => parseCoursewareSourceExportArgs(["--artifact-root", "D:/evidence", "--output-name", "capture", "--provenance", "../p.json"])).toThrow(/provenance/);
    expect(() => parseCoursewareSourceExportArgs(["--artifact-root", "D:/evidence", "--output-name", "capture", "--provenance", "https://example.test/p.json"])).toThrow(/provenance/);
  });

  it("moves DATABASE_URL secrets out of argv and into libpq environment variables", () => {
    const environment = libpqEnvironmentFromDatabaseUrl(
      `${databaseUrl("p@ss", ":6543")}?sslmode=require`,
      { NODE_ENV: "test", DATABASE_URL: "must-disappear", SAFE: "kept" },
    );
    expect(environment).toMatchObject({
      PGHOST: "db.internal",
      PGPORT: "6543",
      PGUSER: "reader",
      PGPASSWORD: "p@ss",
      PGDATABASE: "mathin",
      PGSSLMODE: "require",
    });
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("SAFE");
    expect(() => libpqEnvironmentFromDatabaseUrl("https://db.invalid/mathin")).toThrow(/postgres/);
    expect(() => libpqEnvironmentFromDatabaseUrl("postgresql://reader@db/mathin?application_name=leak")).toThrow(/unsupported/);
  });

  it("runs the fixed SQL through a shell-free direct psql process only after read-only-copy attestation", async () => {
    const spawnProcess = vi.fn(() => fakeChild('{"recordType":"meta"}\n'));
    await expect(runReadOnlyCoursewareCapture({
      sql: "begin transaction isolation level repeatable read read only; commit;",
      environment: {
        NODE_ENV: "test",
        R1_COURSEWARE_SOURCE_ENVIRONMENT: "approved-read-only-copy",
        DATABASE_URL: databaseUrl(),
      },
      spawnProcess: spawnProcess as never,
    })).resolves.toContain('"recordType":"meta"');
    expect(spawnProcess).toHaveBeenCalledOnce();
    const [command, args, options] = (spawnProcess.mock.calls as unknown as SpawnCall[])[0]!;
    expect(command).toBe("psql");
    expect(args.join(" ")).not.toContain("postgresql://");
    expect(options).toMatchObject({ shell: false });
    expect(options.env).not.toHaveProperty("DATABASE_URL");
    expect(options.env?.PGPASSWORD).toBe("password");
    await expect(runReadOnlyCoursewareCapture({
      sql: "select 1;",
      environment: { NODE_ENV: "test", DATABASE_URL: databaseUrl() },
      spawnProcess: spawnProcess as never,
    })).rejects.toThrow(/approved-read-only-copy/);
  });

  it("uses a constrained SSH target and never invokes a shell", async () => {
    const spawnProcess = vi.fn(() => fakeChild("ok\n"));
    await expect(runReadOnlyCoursewareCapture({
      sql: "select 1;",
      environment: {
        NODE_ENV: "test",
        R1_COURSEWARE_SOURCE_ENVIRONMENT: "approved-read-only-copy",
        SUPABASE_DB_SSH: "reader@db-copy",
        SUPABASE_SECRET_KEY: "must-not-reach-child",
      },
      spawnProcess: spawnProcess as never,
    })).resolves.toBe("ok\n");
    const [, args, options] = (spawnProcess.mock.calls as unknown as SpawnCall[])[0]!;
    expect(args[0]).toBe("reader@db-copy");
    expect(options.shell).toBe(false);
    expect(options.env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    await expect(runReadOnlyCoursewareCapture({
      sql: "select 1;",
      environment: {
        NODE_ENV: "test",
        R1_COURSEWARE_SOURCE_ENVIRONMENT: "approved-read-only-copy",
        SUPABASE_DB_SSH: "-oProxyCommand=bad",
      },
      spawnProcess: spawnProcess as never,
    })).rejects.toThrow(/invalid/);
  });

  it("redacts endpoint and token material from database failures", async () => {
    const spawnProcess = vi.fn(() => fakeChild("", 1));
    const error = await runReadOnlyCoursewareCapture({
      sql: "select 1;",
      environment: {
        NODE_ENV: "test",
        R1_COURSEWARE_SOURCE_ENVIRONMENT: "approved-read-only-copy",
        DATABASE_URL: databaseUrl(),
      },
      spawnProcess: spawnProcess as never,
    }).catch((value) => value as Error);
    expect(error.message).not.toContain("secret.invalid");
    expect(error.message).not.toContain("hidden");
    expect(error.message).toContain("[redacted-endpoint]");
  });

  it("streams authenticated Storage reads and recursively lists an H5 prefix without exposing the key", async () => {
    const key = "service-key-value-that-must-stay-private";
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.includes("/object/list/")) {
        const prefix = JSON.parse(String(init.body)).prefix;
        const rows = prefix.endsWith("/assets")
          ? [{ id: "file-2", name: "数学.js" }]
          : [{ id: "file-1", name: "__mathin_manifest.json" }, { id: null, name: "assets" }];
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      return new Response(new TextEncoder().encode("actual bytes"), { status: 200 });
    });
    const storage = createReadOnlyStorageClient({ baseUrl: "https://storage.example.test", key, fetchImpl: fetchImpl as never });
    const listed = await storage.listTree("cw-h5", "packages/abc");
    expect(listed).toEqual([
      "packages/abc/__mathin_manifest.json",
      "packages/abc/assets/数学.js",
    ]);
    const stream = await storage.openObject("cw-h5", "packages/abc/assets/数学.js");
    await expect(hashStorageByteStream(stream)).resolves.toMatchObject({ byteCount: 12 });
    expect(requests.every(({ url }) => !url.includes(key))).toBe(true);
    expect(requests.every(({ init }) => init.redirect === "error")).toBe(true);
    expect(requests.filter(({ init }) => init.method !== "GET").every(({ init }) => init.method === "POST")).toBe(true);
  });

  it("reports Storage failures without returning URLs or credentials", async () => {
    const client = createReadOnlyStorageClient({
      baseUrl: "https://storage.example.test",
      key: "service-key-value-that-must-stay-private",
      fetchImpl: vi.fn(async () => new Response("missing", { status: 404 })) as never,
    });
    let message = "";
    try {
      await client.openObject("cw-objects", "sha256/aa/hash");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("R1 courseware source exporter: Storage read cw-objects failed with HTTP 404");
  });

  it("maps a captured migration version to exactly one tracked migration name", () => {
    expect(resolveCapturedMigrationHead("20260813000500")).toBe("20260813000500_p6_aixuexi_v31_levels");
    expect(() => resolveCapturedMigrationHead("20260813999999")).toThrow(/exactly one/);
  });
});
