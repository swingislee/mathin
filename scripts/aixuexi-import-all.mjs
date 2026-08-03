import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  throw new Error("AIXUEXI_IMPORT_ALL: " + message);
}

function parseArgs(argv) {
  const packageKey = "2026-gplus-sujiao-math";
  const options = {
    packageRoot: path.resolve(process.cwd(), ".tmp", "aixuexi-import", packageKey),
    storeRoot: path.resolve(process.cwd(), "..", "2026-07_mofaxiao_courseware"),
    sshHost: process.env.CW_IMPORT_SSH_HOST ?? "xiaomi",
    startAt: 1,
    limit: Number.POSITIVE_INFINITY,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (["--package-root", "--store-root", "--ssh-host", "--start-at", "--limit"].includes(arg)) {
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
  return options;
}

export async function importAll(options) {
  const lectures = (await readFile(path.join(options.packageRoot, "lectures.ndjson"), "utf8"))
    .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const selected = lectures.slice(options.startAt - 1, options.startAt - 1 + options.limit);
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
      "--ssh-host", options.sshHost,
    ];
    if (options.dryRun) args.push("--dry-run");
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
    const result = JSON.parse(child.stdout);
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
    baselineDrift: results.reduce((sum, result) => sum + (result.database?.pages.baselineDrift ?? 0), 0),
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
