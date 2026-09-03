import type { ClassImportCourseOption, MofaxiaoClassImportRow } from "./actions/types";

type WorksheetCell = unknown;

type FieldKey =
  | "externalClassId"
  | "name"
  | "teachingMode"
  | "courseName"
  | "courseType"
  | "progressText"
  | "subject"
  | "grade"
  | "season"
  | "classType"
  | "assessmentDifficulty"
  | "teacherName"
  | "campusName"
  | "roomName"
  | "feeText"
  | "currentStudentCount"
  | "enrolledCount"
  | "capacity"
  | "sourceStatus"
  | "startDate"
  | "endDate"
  | "sessionTime"
  | "purchasedText";

const HEADER_ALIASES: Record<FieldKey, readonly string[]> = {
  externalClassId: ["班级ID", "班级编号"],
  name: ["班级名称", "名称"],
  teachingMode: ["授课方式"],
  courseName: ["课程名称", "课程"],
  courseType: ["课程类型"],
  progressText: ["进度"],
  subject: ["学科"],
  grade: ["年级", "学生年级"],
  season: ["学期", "季节"],
  classType: ["班型"],
  assessmentDifficulty: ["测评难度"],
  teacherName: ["班级老师", "老师", "主讲老师"],
  campusName: ["校区"],
  roomName: ["教室"],
  feeText: ["课程费用", "费用"],
  currentStudentCount: ["在班人数"],
  enrolledCount: ["已报", "已报名人数"],
  capacity: ["预招人数", "班级容量", "容量"],
  sourceStatus: ["班级状态", "状态"],
  startDate: ["开课日期", "开始日期"],
  endDate: ["结束日期", "结课日期"],
  sessionTime: ["讲次时间", "上课时间"],
  purchasedText: ["已购"],
};

const NORMALIZED_HEADERS = new Map<string, FieldKey>();
for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[FieldKey, readonly string[]]>) {
  for (const alias of aliases) NORMALIZED_HEADERS.set(normalizeHeader(alias), field);
}

const GRADE_WORDS = new Map<string, number>([
  ["一年级", 1], ["二年级", 2], ["三年级", 3], ["四年级", 4], ["五年级", 5], ["六年级", 6],
  ["七年级", 7], ["八年级", 8], ["九年级", 9], ["十年级", 10], ["十一年级", 11], ["十二年级", 12],
  ["小一", 1], ["小二", 2], ["小三", 3], ["小四", 4], ["小五", 5], ["小六", 6],
  ["初一", 7], ["初二", 8], ["初三", 9], ["高一", 10], ["高二", 11], ["高三", 12],
]);

const NO_GRADE_VALUES = new Set(["", "无", "无年级", "启蒙阶段", "未填写", "未知", "暂无"]);
const SEASONS = new Map<string, number>([
  ["暑期", 1], ["暑假", 1], ["夏季", 1],
  ["秋季", 2],
  ["寒假", 3], ["冬季", 3],
  ["春季", 4],
]);
const AIXUEXI_PRIMARY_MATH_FAMILY = "aixuexi-primary-math";
const INTEGRATED_THINKING_LEVELS = new Set(["G+", "A+"]);

export type MofaxiaoClassParseErrorCode = "EMPTY_SHEET" | "UNRECOGNIZED_HEADERS" | "MISSING_REQUIRED_HEADERS";

export class MofaxiaoClassParseError extends Error {
  constructor(public readonly code: MofaxiaoClassParseErrorCode) {
    super(code);
    this.name = "MofaxiaoClassParseError";
  }
}

export interface ParsedMofaxiaoClassWorksheet {
  sheetName: string;
  headerRow: number;
  recognizedHeaders: string[];
  rows: MofaxiaoClassImportRow[];
}

function textOf(value: WorksheetCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).replace(/^\uFEFF/, "").trim();
}

function normalizeHeader(value: string): string {
  return value.replace(/[\s\u3000]+/g, "").replace(/[（]/g, "(").replace(/[）]/g, ")").toLowerCase();
}

export function normalizeClassImportText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\u3000]+/g, "");
}

export function isMofaxiaoIntegratedThinkingCourse(row: Pick<MofaxiaoClassImportRow, "courseName">): boolean {
  return normalizeClassImportText(row.courseName).includes("贯通思维");
}

function courseMatchesGradeAndSeason(
  row: Pick<MofaxiaoClassImportRow, "grade" | "season">,
  course: ClassImportCourseOption,
): boolean {
  return (row.grade === null || course.grade === row.grade)
    && (row.season === null || course.season === null || course.season === row.season);
}

export function listMofaxiaoClassCourseCandidates(
  row: Pick<MofaxiaoClassImportRow, "courseName" | "grade" | "season">,
  courseOptions: readonly ClassImportCourseOption[],
): ClassImportCourseOption[] {
  const integratedThinking = isMofaxiaoIntegratedThinkingCourse(row);
  return courseOptions
    .filter((course) => courseMatchesGradeAndSeason(row, course)
      && (!integratedThinking || (
        course.familySlug === AIXUEXI_PRIMARY_MATH_FAMILY
        && INTEGRATED_THINKING_LEVELS.has(course.classType)
      )))
    .sort((left, right) => {
      const leftExact = normalizeClassImportText(left.title) === normalizeClassImportText(row.courseName) ? 1 : 0;
      const rightExact = normalizeClassImportText(right.title) === normalizeClassImportText(row.courseName) ? 1 : 0;
      return rightExact - leftExact
        || Number(right.catalogVersionCurrent) - Number(left.catalogVersionCurrent)
        || left.title.localeCompare(right.title, "zh-CN");
    });
}

export function preferredMofaxiaoClassCourseCandidate(
  row: Pick<MofaxiaoClassImportRow, "courseName" | "grade" | "season">,
  courseOptions: readonly ClassImportCourseOption[],
): ClassImportCourseOption | null {
  const candidates = listMofaxiaoClassCourseCandidates(row, courseOptions);
  const eligible = isMofaxiaoIntegratedThinkingCourse(row)
    ? candidates
    : candidates.filter((course) => normalizeClassImportText(course.title) === normalizeClassImportText(row.courseName));
  const current = eligible.filter((course) => course.catalogVersionCurrent);
  return current.length === 1 ? current[0] : eligible.length === 1 ? eligible[0] : null;
}

function headerMapping(row: readonly WorksheetCell[]): Map<FieldKey, number> {
  const mapping = new Map<FieldKey, number>();
  row.forEach((value, index) => {
    const field = NORMALIZED_HEADERS.get(normalizeHeader(textOf(value)));
    if (field && !mapping.has(field)) mapping.set(field, index);
  });
  return mapping;
}

function cell(row: readonly WorksheetCell[], mapping: Map<FieldKey, number>, field: FieldKey): WorksheetCell {
  const index = mapping.get(field);
  return index === undefined ? null : row[index];
}

function clipped(value: WorksheetCell, max: number): string {
  return textOf(value).slice(0, max);
}

function parseGrade(value: WorksheetCell): { value: number | null; text: string; unmapped: boolean } {
  const raw = textOf(value);
  const compact = raw.replace(/\s+/g, "");
  if (NO_GRADE_VALUES.has(compact)) return { value: null, text: raw, unmapped: false };
  const word = GRADE_WORDS.get(compact);
  if (word) return { value: word, text: raw, unmapped: false };
  const numeric = compact.match(/^(?:第)?(\d{1,2})(?:年级)?$/);
  if (numeric) {
    const grade = Number(numeric[1]);
    if (grade >= 1 && grade <= 12) return { value: grade, text: raw, unmapped: false };
  }
  return { value: null, text: raw, unmapped: true };
}

function parseSeason(value: WorksheetCell): { value: number | null; text: string } {
  const raw = textOf(value);
  return { value: SEASONS.get(raw.replace(/\s+/g, "")) ?? null, text: raw };
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseDate(value: WorksheetCell): { value: string | null; text: string } {
  const raw = textOf(value);
  if (!raw) return { value: null, text: "" };
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { value: raw, text: raw };
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
    const parsed = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return { value: parsed, text: raw };
  }
  const match = raw.match(/^(\d{4})[年/.\-](\d{1,2})[月/.\-](\d{1,2})(?:日)?$/);
  if (!match) return { value: null, text: raw };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return { value: null, text: raw };
  return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, text: raw };
}

function parseCount(value: WorksheetCell, min: number, max: number): { value: number | null; invalid: boolean } {
  const raw = textOf(value);
  if (!raw) return { value: null, invalid: false };
  if (!/^\d+$/.test(raw)) return { value: null, invalid: true };
  const number = Number(raw);
  return Number.isSafeInteger(number) && number >= min && number <= max
    ? { value: number, invalid: false }
    : { value: null, invalid: true };
}

export function isSupportedMofaxiaoClassType(value: string): boolean {
  return value === "长期班" || value === "短期班";
}

export function inferMofaxiaoSchoolYearStart(
  startDate: string | null,
  season: number | null,
  fallbackStartYear: number | null,
): number | null {
  if (!startDate || season === null) return fallbackStartYear;
  const year = Number(startDate.slice(0, 4));
  if (!Number.isInteger(year)) return fallbackStartYear;
  return season === 3 || season === 4 ? year - 1 : year;
}

export function parseMofaxiaoClassWorksheet(
  grid: readonly (readonly WorksheetCell[])[],
  sheetName = "Worksheet",
): ParsedMofaxiaoClassWorksheet {
  if (grid.length === 0 || grid.every((row) => row.every((value) => !textOf(value)))) {
    throw new MofaxiaoClassParseError("EMPTY_SHEET");
  }

  let headerIndex = -1;
  let mapping = new Map<FieldKey, number>();
  for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
    const candidate = headerMapping(grid[index]);
    if (candidate.has("externalClassId") && candidate.has("name") && candidate.size > mapping.size) {
      headerIndex = index;
      mapping = candidate;
    }
  }
  if (headerIndex < 0) throw new MofaxiaoClassParseError("MISSING_REQUIRED_HEADERS");
  if (!["teachingMode", "courseName", "courseType", "season", "teacherName", "sourceStatus"]
    .every((field) => mapping.has(field as FieldKey))) {
    throw new MofaxiaoClassParseError("MISSING_REQUIRED_HEADERS");
  }
  if (mapping.size < 8) throw new MofaxiaoClassParseError("UNRECOGNIZED_HEADERS");

  const rows: MofaxiaoClassImportRow[] = [];
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index];
    if (!row.some((value) => textOf(value))) continue;
    const grade = parseGrade(cell(row, mapping, "grade"));
    const season = parseSeason(cell(row, mapping, "season"));
    const currentStudentCount = parseCount(cell(row, mapping, "currentStudentCount"), 0, 100_000);
    const enrolledCount = parseCount(cell(row, mapping, "enrolledCount"), 0, 100_000);
    const capacity = parseCount(cell(row, mapping, "capacity"), 1, 500);
    const startDate = parseDate(cell(row, mapping, "startDate"));
    const endDate = parseDate(cell(row, mapping, "endDate"));
    rows.push({
      sourceRow: index + 1,
      externalClassId: clipped(cell(row, mapping, "externalClassId"), 1_000),
      name: clipped(cell(row, mapping, "name"), 1_000),
      teachingMode: clipped(cell(row, mapping, "teachingMode"), 200),
      courseName: clipped(cell(row, mapping, "courseName"), 1_000),
      courseType: clipped(cell(row, mapping, "courseType"), 200),
      progressText: clipped(cell(row, mapping, "progressText"), 200),
      subject: clipped(cell(row, mapping, "subject"), 200),
      grade: grade.value,
      gradeText: grade.text.slice(0, 200),
      gradeUnmapped: grade.unmapped,
      season: season.value,
      seasonText: season.text.slice(0, 200),
      classType: clipped(cell(row, mapping, "classType"), 200),
      assessmentDifficulty: clipped(cell(row, mapping, "assessmentDifficulty"), 200),
      teacherName: clipped(cell(row, mapping, "teacherName"), 1_000),
      campusName: clipped(cell(row, mapping, "campusName"), 1_000),
      roomName: clipped(cell(row, mapping, "roomName"), 1_000),
      feeText: clipped(cell(row, mapping, "feeText"), 200),
      currentStudentCount: currentStudentCount.value,
      enrolledCount: enrolledCount.value,
      capacity: capacity.value,
      capacityInvalid: capacity.invalid,
      sourceStatus: clipped(cell(row, mapping, "sourceStatus"), 200),
      startDate: startDate.value,
      startDateText: startDate.text.slice(0, 200),
      endDate: endDate.value,
      endDateText: endDate.text.slice(0, 200),
      sessionTime: clipped(cell(row, mapping, "sessionTime"), 200),
      purchasedText: clipped(cell(row, mapping, "purchasedText"), 200),
      courseId: null,
      importAsFreeClass: false,
      primaryTeacherId: null,
      roomId: null,
      schoolTermId: null,
    });
  }

  if (rows.length === 0) throw new MofaxiaoClassParseError("EMPTY_SHEET");
  return {
    sheetName,
    headerRow: headerIndex + 1,
    recognizedHeaders: [...mapping.keys()],
    rows,
  };
}
