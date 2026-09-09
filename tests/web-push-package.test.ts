import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { packageWorkerRuntime } from "../scripts/ops/package-worker-runtime.mjs";

it("loads the full worker dependency tree outside the source checkout", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "mathin-worker-package-"));
  try {
    expect(await packageWorkerRuntime(process.cwd(), target)).toEqual({
      result: "WORKER_RUNTIME_PASS", packages: expect.any(Number),
    });
    const require = createRequire(path.join(target, "scripts/r1-job-worker.mjs"));
    const push = require("web-push");
    const keys = push.generateVAPIDKeys();
    expect(Buffer.from(keys.publicKey, "base64url")).toHaveLength(65);
    expect(Buffer.from(keys.privateKey, "base64url")).toHaveLength(32);
    expect(typeof require("@supabase/supabase-js").createClient).toBe("function");
    const metadata = JSON.parse(await readFile(path.join(target, "scripts/node_modules/web-push/package.json"), "utf8"));
    expect(metadata.version).toBe("3.6.7");
    const nested = createRequire(require.resolve("web-push"));
    expect(nested.resolve("asn1.js").startsWith(target + path.sep)).toBe(true);
  } finally {
    if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith("mathin-worker-package-")) {
      await rm(target, { recursive: true, force: true });
    }
  }
}, 30000);
