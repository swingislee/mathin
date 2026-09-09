import { cp, mkdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Worker 不属于 Next 路由 tracing；将完整依赖树放在 scripts/node_modules 独立解析。
export async function packageWorkerRuntime(sourceRoot, releaseRoot) {
  const copied = new Set();
  async function copyPackage(name, parentSource, parentTarget, ancestors = new Set()) {
    const require = createRequire(path.join(parentSource, "package.json"));
    const entry = require.resolve(name);
    let source = path.dirname(entry);
    for (;;) {
      try {
        const metadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
        if (metadata.name === name) break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = path.dirname(source);
      if (parent === source) throw new Error("WORKER_PACKAGE_ROOT_NOT_FOUND");
      source = parent;
    }
    source = await realpath(source);
    if (ancestors.has(source)) return;
    const target = path.join(parentTarget, "node_modules", name);
    await cp(source, target, {
      recursive: true, dereference: true, errorOnExist: true, force: false,
      filter: (file) => !path.relative(source, file).split(path.sep).includes("node_modules"),
    });
    copied.add(name);
    const metadata = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    const next = new Set([...ancestors, source]);
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      await copyPackage(dependency, source, target, next);
    }
  }
  const scriptsRoot = path.join(releaseRoot, "scripts");
  await mkdir(scriptsRoot, { recursive: true });
  for (const name of ["@supabase/supabase-js", "web-push"]) {
    await copyPackage(name, sourceRoot, scriptsRoot);
  }
  const require = createRequire(path.join(scriptsRoot, "r1-job-worker.mjs"));
  const push = require("web-push");
  const keys = push.generateVAPIDKeys();
  if (!keys.publicKey || !keys.privateKey || typeof require("@supabase/supabase-js").createClient !== "function") {
    throw new Error("WORKER_RUNTIME_LOAD_FAILED");
  }
  return { result: "WORKER_RUNTIME_PASS", packages: copied.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await packageWorkerRuntime(path.resolve(process.argv[2]), path.resolve(process.argv[3]))));
}
