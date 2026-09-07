import { readFileSync } from "node:fs";
import { parseSchoolGrade } from "../../src/lib/grade-format.mjs";

const definitions = JSON.parse(readFileSync(new URL("../config/aixuexi-packages.json", import.meta.url), "utf8"));
export function parseAixuexiGrade(value) {
  if (typeof value !== "string") return null;
  const grade = parseSchoolGrade(value);
  return grade !== null && grade <= 6 ? grade : null;
}
const TERM_CODES = new Map([["寒假", "WIN"], ["春季", "SPR"], ["暑期", "SUM"], ["秋季", "AUT"]]);

function fail(message) { throw new Error(`AIXUEXI_SCOPE: ${message}`); }

export function aixuexiPackageDefinition(packageKey) {
  return definitions[packageKey] ? structuredClone(definitions[packageKey]) : null;
}

export function validateAixuexiPackageDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isInteger(value.year) || value.year < 2000 || value.year > 2200
      || !Array.isArray(value.grades) || value.grades.length === 0
      || value.grades.some((grade) => !Number.isInteger(grade) || grade < 1 || grade > 6)
      || new Set(value.grades).size !== value.grades.length
      || !["X+", "G+", "A+"].includes(value.level)
      || typeof value.sourceLevel !== "string" || !value.sourceLevel.trim()
      || typeof value.edition !== "string" || !value.edition.trim()
      || typeof value.productPrefix !== "string" || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value.productPrefix)
      || TERM_CODES.get(value.term) !== value.termCode) {
    fail("课程包配置需包含 year、grades、level、sourceLevel、edition、productPrefix 和有效的 term/termCode");
  }
  return structuredClone(value);
}

export function normalizeAixuexiLessonIds(values = []) {
  if (!Array.isArray(values)) fail("lessonIds 必须为数组");
  const ids = values.flatMap((value) => String(value).split(","));
  if (ids.some((id) => !/^\d{1,30}$/.test(id))) fail("讲次 ID 必须为源站数字 ID");
  return [...new Set(ids)].sort();
}

export function selectAixuexiLectures(lectures, options = {}) {
  const ids = normalizeAixuexiLessonIds(options.lessonIds);
  const known = new Set();
  for (const lecture of lectures) {
    if (typeof lecture.coursewareId !== "string" || known.has(lecture.coursewareId)) {
      fail("讲次清单包含无效或重复的 coursewareId");
    }
    known.add(lecture.coursewareId);
  }
  if (ids.length) {
    if ((options.startAt ?? 1) !== 1 || Number.isFinite(options.limit ?? Infinity)) {
      fail("--lesson-id 与 --start-at/--limit 分别使用");
    }
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) fail(`来源清单没有这些讲次：${missing.join(", ")}`);
    const selected = new Set(ids);
    return lectures.filter((lecture) => selected.has(lecture.coursewareId));
  }
  const selected = lectures.slice((options.startAt ?? 1) - 1,
    (options.startAt ?? 1) - 1 + (options.limit ?? Infinity));
  if (!selected.length) fail("本次选择没有讲次");
  return selected;
}

export function assertAixuexiSourceScope(siteManifest, catalog, definition, options = {}) {
  if (siteManifest.sourceSystem !== "aixuexi_bsk"
      || siteManifest.schemaVersion !== 1 || catalog.schemaVersion !== 1
      || siteManifest.packageKey !== options.packageKey || catalog.packageKey !== options.packageKey) {
    fail("来源 manifest、catalog 与目标课程包不一致");
  }
  if (!Array.isArray(catalog.courses) || catalog.courses.length === 0
      || siteManifest.courseCount !== catalog.courses.length || catalog.courseCount !== catalog.courses.length
      || catalog.courses.some((course) => !Number.isInteger(course.pageCount) || course.pageCount < 0)
      || siteManifest.pageCount !== catalog.courses.reduce((sum, course) => sum + course.pageCount, 0)) {
    fail("来源 manifest 与 catalog 的实际讲页数量不一致");
  }
  if (options.checkBaselineCounts && (siteManifest.courseCount !== definition.lectureCount
      || siteManifest.pageCount !== definition.pageCount)) {
    fail("来源数量与配置中的历史整包基线不一致");
  }
  const selected = selectAixuexiLectures(catalog.courses, options);
  if (!options.lessonIds?.length && (siteManifest.projectedPageCount !== siteManifest.pageCount
      || siteManifest.unsupportedLayoutNodeCount !== 0 || siteManifest.unmappedLayoutResourceCount !== 0
      || siteManifest.registeredGapNodeCount !== 0 || siteManifest.registeredGapResourceCount !== 0)) {
    fail("来源整包仍有投影缺口");
  }
  for (const course of selected) {
    if (!definition.grades.includes(parseAixuexiGrade(course.grade))
        || course.term !== definition.term || course.level !== definition.sourceLevel
        || course.status !== "complete" || course.pageCount < 1
        || !Number.isInteger(course.lessonIndex) || course.lessonIndex < 1) {
      fail(`讲次 ${course.coursewareId} 尚未完成或不属于声明的课程范围`);
    }
  }
  return selected;
}
