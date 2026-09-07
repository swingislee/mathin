import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mergeAixuexiCatalogCapture } from "./lib/aixuexi-catalog-merge.mjs";

// 此桥由来源仓库的 tsx 加载，复用来源的配置、HAR 检查和目录合同。
export async function prepareSource({ sourceRoot, configPath, inputRoot, outputRoot }) {
  const fromSource = (relative) => import(pathToFileURL(path.join(sourceRoot, "src", relative)).href);
  const [{ loadConfig }, { collectAixuexiHarPaths }, { buildAixuexiCatalogFromHar }, { parseAixuexiAutumnCatalogCapture }] = await Promise.all([
    fromSource("config/load-config.ts"), fromSource("aixuexi/har-paths.ts"),
    fromSource("aixuexi/catalog-from-har.ts"), fromSource("aixuexi/import-autumn-catalog.ts"),
  ]);
  const config = await loadConfig(configPath, { workspaceRoot: sourceRoot });
  if (config.raw.package.sourceSystem !== "aixuexi_bsk") throw new Error("AIXUEXI_CONFIG_REQUIRED");
  const harPaths = await collectAixuexiHarPaths({ harDirectories: [inputRoot] });
  const labels = config.raw.package.labels;
  const hashes = await Promise.all(harPaths.map(async (file) => ({ file: path.basename(file), sha256: createHash("sha256").update(await readFile(file)).digest("hex") })));
  const inputFingerprint = createHash("sha256").update(JSON.stringify({ package: config.raw.package, hashes })).digest("hex");
  const result = await buildAixuexiCatalogFromHar({
    harPaths, packageKey: config.raw.package.key,
    scope: { ...labels, term: labels.term ?? "秋季" }, includeIncompleteCourses: true,
    capturedAt: new Date().toISOString(),
  });
  if (result.blockedHars.length) throw new Error("AIXUEXI_HAR_BLOCKED: 请查看来源只读预检的缺失输入");
  const requireSource = createRequire(path.join(sourceRoot, "package.json"));
  const Database = requireSource("better-sqlite3");
  const database = new Database(config.paths.stateDb, { readonly: true, fileMustExist: true });
  let snapshot;
  try { snapshot = database.prepare("select sha256,object_relative_path from aixuexi_catalog_snapshots where package_key=? and active=1").get(config.raw.package.key); }
  finally { database.close(); }
  let base = null;
  if (snapshot) {
    const file = path.resolve(config.paths.storeDir, snapshot.object_relative_path);
    if (!file.startsWith(`${path.resolve(config.paths.storeDir)}${path.sep}`)) throw new Error("AIXUEXI_SOURCE_SNAPSHOT_PATH_INVALID");
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== snapshot.sha256) throw new Error("AIXUEXI_SOURCE_SNAPSHOT_HASH_MISMATCH");
    base = parseAixuexiAutumnCatalogCapture(JSON.parse(bytes.toString("utf8")));
  }
  const capture = parseAixuexiAutumnCatalogCapture(mergeAixuexiCatalogCapture(base, result.capture));
  let existingExportIds = [];
  try {
    const site = JSON.parse(await readFile(path.join(config.paths.exportsDir, "site", "catalog.json"), "utf8"));
    if (!Array.isArray(site.courses)) throw new Error("AIXUEXI_EXISTING_SITE_CATALOG_INVALID");
    existingExportIds = site.courses.map((course) => course.coursewareId);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const observedIds = result.precheck.lessons.filter((lesson) => lesson.usable).map((lesson) => lesson.lessonId).sort();
  const mergedIds = new Set(capture.grades.flatMap((grade) => grade.courses.flatMap((course) => course.lessons.map((lesson) => lesson.lessonId))));
  if (existingExportIds.some((id) => !mergedIds.has(id))) throw new Error("AIXUEXI_TASK_EXPORT_WOULD_DROP_LESSONS");
  const taskRoot = path.join(outputRoot, inputFingerprint);
  await mkdir(taskRoot, { recursive: true });
  const catalogPath = path.join(taskRoot, `catalog-${snapshot?.sha256 ?? "new"}.json`);
  try { await writeFile(catalogPath, `${JSON.stringify(capture, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const summary = {
    inputFingerprint, taskRoot, catalogPath, packageKey: config.raw.package.key, hashes,
    lessonIds: observedIds,
    exportLessonIds: [...new Set([...existingExportIds, ...observedIds])].sort(),
    inputs: result.precheck.lessons.filter((lesson) => lesson.usable).map((lesson) => ({
      lessonId: lesson.lessonId,
      file: path.relative(inputRoot, harPaths[hashes.findIndex((input) => input.sha256 === lesson.sha256)]),
    })),
    courses: capture.grades.reduce((sum, grade) => sum + grade.courses.length, 0),
    lessons: capture.grades.reduce((sum, grade) => sum + grade.courses.reduce((count, course) => count + course.lessons.length, 0), 0),
  };
  await writeFile(path.join(taskRoot, "input.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [sourceRoot, configPath, inputRoot, outputRoot] = process.argv.slice(2);
  prepareSource({ sourceRoot, configPath, inputRoot, outputRoot }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => { process.stderr.write(`${error.code ?? "AIXUEXI_PREPARE_FAILED"}: ${error.message}\n`); process.exitCode = 1; });
}
