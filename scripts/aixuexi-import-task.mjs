import { spawn } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAixuexiPackage } from "./aixuexi-build-package.mjs";
import { importAll } from "./aixuexi-import-all.mjs";
import { importCourseware, loadLocalEnv } from "./cw-import.mjs";
import { assertControlledContentWriteTarget } from "./lib/r1-write-target-policy.mjs";
import { readTaskState, resumeSourceLocalization, runTaskStage } from "./lib/aixuexi-task-state.mjs";

export function parseTaskArgs(argv) {
  const options = { target: "development", sourceRoot: path.resolve("../2026-07_mofaxiao_courseware"), packageKey: "2026-gplus-sujiao-math", databaseUrl: "postgresql://postgres@127.0.0.1:35422/postgres" };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--") continue;
    const flag = argv[index];
    if (!["--input", "--source-root", "--source-config", "--package-key", "--definition", "--catalog-version", "--target"].includes(flag)) throw new Error(`AIXUEXI_TASK_ARGUMENT: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`AIXUEXI_TASK_ARGUMENT: ${flag} 需要参数`);
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!options.input || options.target !== "development") throw new Error("AIXUEXI_TASK_TARGET: 本入口需指定 --input，目标为 development；生产晋级使用独立授权流程");
  options.input = path.resolve(options.input);
  options.sourceRoot = path.resolve(options.sourceRoot);
  options.sourceConfig ??= `config/aixuexi-${options.packageKey}.json`;
  return options;
}

function execute(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(-10000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) { resolve(stdout.trim()); return; }
      const output = stderr || stdout.slice(-10000);
      const error = new Error(`AIXUEXI_TASK_COMMAND_FAILED (${code}): ${output}`);
      try { error.sourceFailure = JSON.parse(output); } catch { /* 非结构化错误按原失败处理。 */ }
      reject(error);
    });
  });
}

async function attestDevelopment(options) {
  const environment = { ...await loadLocalEnv(process.cwd()), ...process.env };
  if (environment.MATHIN_WRITE_TARGET_ENVIRONMENT !== "development") throw new Error("AIXUEXI_TASK_DEVELOPMENT_ATTESTATION_REQUIRED");
  assertControlledContentWriteTarget({ operation: "cw:import", supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL, databaseUrl: options.databaseUrl, environment });
  if (new URL(environment.NEXT_PUBLIC_SUPABASE_URL).origin !== "http://127.0.0.1:35421") throw new Error("AIXUEXI_TASK_LOCAL_ORIGIN_REQUIRED");
  const context = JSON.parse(await execute("docker", ["context", "inspect"], process.cwd()))[0];
  const endpoint = process.env.DOCKER_HOST || context?.Endpoints?.docker?.Host;
  if (!/^(npipe:\/\/|unix:\/\/)/.test(endpoint ?? "")) throw new Error("AIXUEXI_TASK_LOCAL_DOCKER_REQUIRED");
  if (process.platform === "win32") {
    const listeners = JSON.parse(await execute("powershell", ["-NoProfile", "-Command", "$rows = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(35421,35422) }; @($rows | ForEach-Object { @{port=$_.LocalPort; address=$_.LocalAddress; process=(Get-Process -Id $_.OwningProcess).ProcessName} }) | ConvertTo-Json -Compress"], process.cwd()));
    if (![35421, 35422].every((port) => listeners.some((row) => row.port === port && row.address === "127.0.0.1" && row.process === "com.docker.backend"))) throw new Error("AIXUEXI_TASK_LOCAL_LISTENERS_MISMATCH");
  }
  const database = JSON.parse(await execute("docker", ["exec", "supabase-db", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select json_build_object('database',current_database(),'snapshots',to_regclass('public.cw_source_package_snapshots') is not null,'receipts',to_regclass('public.cw_source_lecture_imports') is not null);"], process.cwd()));
  if (database.database !== "postgres" || !database.snapshots || !database.receipts) throw new Error("AIXUEXI_TASK_SOURCE_SNAPSHOT_MIGRATION_REQUIRED: 请先应用增量来源快照迁移");
  return { hostname: os.hostname(), supabaseOrigin: environment.NEXT_PUBLIC_SUPABASE_URL, target: "development", dockerContext: context.Name };
}

export async function runImportTask(options) {
  const target = await attestDevelopment(options);
  const sourceNode = (args) => execute(process.execPath, ["--import", "tsx", ...args], options.sourceRoot);
  const prepared = JSON.parse(await sourceNode([
    fileURLToPath(new URL("./aixuexi-source-prepare.mjs", import.meta.url)), options.sourceRoot, options.sourceConfig,
    options.input, path.resolve(".tmp/aixuexi-tasks"),
  ]));
  if (prepared.packageKey !== options.packageKey) throw new Error("AIXUEXI_TASK_PACKAGE_MISMATCH");
  const lock = path.join(prepared.taskRoot, "lock.json");
  try { await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(await readFile(lock, "utf8"));
    if (owner.host !== os.hostname()) throw new Error("AIXUEXI_TASK_LOCKED");
    try { process.kill(owner.pid, 0); throw new Error("AIXUEXI_TASK_LOCKED"); }
    catch (probe) { if (probe.code !== "ESRCH") throw probe; }
    await unlink(lock);
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }), { flag: "wx" });
  }
  try {
    const stateFile = path.join(prepared.taskRoot, "state.json");
    const state = await readTaskState(stateFile, prepared.inputFingerprint);
    state.target = target;
    const stage = (name, action, refresh = false) => runTaskStage(stateFile, state, name, action, { refresh });
    const source = (args) => sourceNode(["src/cli/index.ts", "--config", options.sourceConfig, "aixuexi", ...args]);
    await stage("source-catalog", () => source(["autumn-catalog-import", "--capture", prepared.catalogPath]));
    for (const input of prepared.inputs) {
      await stage(`source-bootstrap-${input.lessonId}`, () => source(["har-bootstrap", "--har", path.resolve(options.input, input.file), "--output", path.join(prepared.taskRoot, "bootstrap", input.lessonId)]));
    }
    await stage("source-player-assets", () => source(["player-assets-import", "--har-dir", options.input]));
    await stage("source-localize", () => resumeSourceLocalization(
      () => source(["localize", "--har-dir", options.input, "--lesson-id", ...prepared.lessonIds]),
      () => process.stderr.write("AIXUEXI_TASK: 来源队列已前进，继续可恢复的本地阶段\n"),
    ));
    await stage("source-complete-export", () => source(["viewer-export", "--lesson-id", ...prepared.exportLessonIds]));
    await stage("source-layout-final", () => source(["page-inspect", "--lesson-id", ...prepared.lessonIds]));
    await stage("source-layout-final-audit", () => source(["page-inspect-audit", "--lesson-id", ...prepared.lessonIds]));
    const build = await stage("build", () => buildAixuexiPackage({ sourceRoot: options.sourceRoot, packageKey: options.packageKey, lessonIds: prepared.lessonIds, definition: options.definition, outputRoot: path.join(prepared.taskRoot, "build") }), true);
    const importOptions = { packageRoot: build.outputRoot, storeRoot: options.sourceRoot, lessonIds: prepared.lessonIds, localDocker: true, databaseUrl: options.databaseUrl, incrementalSource: true, catalogVersion: options.catalogVersion, startAt: 1 };
    const mapping = await stage("mapping", async () => {
      const result = [];
      for (const id of prepared.lessonIds) result.push(await importCourseware({ ...importOptions, coursewareId: id, dryRun: true }));
      await writeFile(path.join(prepared.taskRoot, "mapping.json"), JSON.stringify(result, null, 2), "utf8");
      return result;
    }, true);
    const imported = await stage("import", () => importAll(importOptions), true);
    return { taskRoot: prepared.taskRoot, packageKey: prepared.packageKey, lessonIds: prepared.lessonIds, buildReused: build.reused, ...imported,
      lectures: mapping.map((item) => ({ coursewareId: item.coursewareId, lectureId: item.preflight.lectureId, disposition: item.disposition,
        url: `http://192.168.5.213:3130/zh/dashboard/courseware/lectures/${item.preflight.lectureId}` })) };
  } finally { await unlink(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runImportTask(parseTaskArgs(process.argv.slice(2))).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
