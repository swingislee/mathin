import type { MofaxiaoStudentImportRow } from "./actions/types";

type WorksheetCell = unknown;

type FieldKey =
  | "externalStudentId"
  | "name"
  | "phone"
  | "gender"
  | "birthday"
  | "school"
  | "publicSchoolClass"
  | "grade"
  | "parentName"
  | "parentRelation"
  | "parentPhone"
  | "remark"
  | "source"
  | "marketActivity"
  | "tag1"
  | "tag2"
  | "tag3";

const HEADER_ALIASES: Record<FieldKey, readonly string[]> = {
  externalStudentId: ["学生ID", "学生编号"],
  name: ["学生姓名", "姓名"],
  phone: ["联系电话", "学生电话", "手机号"],
  gender: ["性别"],
  birthday: ["学生生日", "生日"],
  school: ["所属公立校", "公立学校", "学校"],
  publicSchoolClass: ["公立校班级", "公立学校班级"],
  grade: ["学生年级", "年级"],
  parentName: ["家长姓名"],
  parentRelation: ["关系", "家长关系"],
  parentPhone: ["家长电话", "家长手机号"],
  remark: ["备注"],
  source: ["来源渠道", "来源"],
  marketActivity: ["市场活动"],
  tag1: ["标签1", "标签一"],
  tag2: ["标签2", "标签二"],
  tag3: ["标签3", "标签三"],
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

const NO_GRADE_VALUES = new Set(["", "无", "无年级", "未填写", "未知", "暂无"]);

export type MofaxiaoParseErrorCode = "EMPTY_SHEET" | "UNRECOGNIZED_HEADERS" | "MISSING_REQUIRED_HEADERS";

export class MofaxiaoParseError extends Error {
  constructor(public readonly code: MofaxiaoParseErrorCode) {
    super(code);
    this.name = "MofaxiaoParseError";
  }
}

export interface ParsedMofaxiaoWorksheet {
  headerRow: number;
  recognizedHeaders: string[];
  rows: MofaxiaoStudentImportRow[];
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

function headerMapping(row: readonly WorksheetCell[]): Map<FieldKey, number> {
  const mapping = new Map<FieldKey, number>();
  row.forEach((cell, index) => {
    const field = NORMALIZED_HEADERS.get(normalizeHeader(textOf(cell)));
    if (field && !mapping.has(field)) mapping.set(field, index);
  });
  return mapping;
}

function parsePhone(raw: string): { value: string; masked: boolean; invalid: boolean } {
  if (!raw) return { value: "", masked: false, invalid: false };
  if (/[*＊xX]{2,}/.test(raw)) return { value: "", masked: true, invalid: false };
  const normalized = raw.replace(/[\s\-()（）]/g, "");
  if (!/^\+?\d{6,20}$/.test(normalized)) return { value: "", masked: false, invalid: true };
  return { value: normalized, masked: false, invalid: false };
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseBirthday(value: WorksheetCell): { value: string | null; text: string } {
  const raw = textOf(value);
  if (!raw) return { value: null, text: "" };
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { value: raw, text: raw };
  if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100000) {
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

function parseGrade(value: WorksheetCell): { value: number | null; text: string; unmapped: boolean } {
  const raw = textOf(value);
  const compact = raw.replace(/\s+/g, "");
  if (NO_GRADE_VALUES.has(compact)) return { value: null, text: raw, unmapped: false };
  const wordValue = GRADE_WORDS.get(compact);
  if (wordValue) return { value: wordValue, text: raw, unmapped: false };
  const numeric = compact.match(/^(?:第)?(\d{1,2})(?:年级)?$/);
  if (numeric) {
    const grade = Number(numeric[1]);
    if (grade >= 1 && grade <= 12) return { value: grade, text: raw, unmapped: false };
  }
  return { value: null, text: raw, unmapped: true };
}

function cell(row: readonly WorksheetCell[], mapping: Map<FieldKey, number>, field: FieldKey): WorksheetCell {
  const index = mapping.get(field);
  return index === undefined ? null : row[index];
}

function clipped(value: WorksheetCell, max: number): string {
  return textOf(value).slice(0, max);
}

export function parseMofaxiaoWorksheet(grid: readonly (readonly WorksheetCell[])[]): ParsedMofaxiaoWorksheet {
  if (grid.length === 0 || grid.every((row) => row.every((value) => !textOf(value)))) {
    throw new MofaxiaoParseError("EMPTY_SHEET");
  }

  let headerIndex = -1;
  let mapping = new Map<FieldKey, number>();
  for (let index = 0; index < Math.min(grid.length, 30); index += 1) {
    const candidate = headerMapping(grid[index]);
    if (candidate.has("name") && candidate.size > mapping.size) {
      headerIndex = index;
      mapping = candidate;
    }
  }
  if (headerIndex < 0) throw new MofaxiaoParseError("MISSING_REQUIRED_HEADERS");
  if (mapping.size < 3) throw new MofaxiaoParseError("UNRECOGNIZED_HEADERS");

  const rows: MofaxiaoStudentImportRow[] = [];
  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index];
    if (!row.some((value) => textOf(value))) continue;
    const phone = parsePhone(textOf(cell(row, mapping, "phone")));
    const parentPhone = parsePhone(textOf(cell(row, mapping, "parentPhone")));
    const birthday = parseBirthday(cell(row, mapping, "birthday"));
    const grade = parseGrade(cell(row, mapping, "grade"));
    const tags = ["tag1", "tag2", "tag3"]
      .map((field) => clipped(cell(row, mapping, field as FieldKey), 500))
      .filter((value, tagIndex, values) => value && values.indexOf(value) === tagIndex);
    rows.push({
      sourceRow: index + 1,
      externalStudentId: clipped(cell(row, mapping, "externalStudentId"), 1_000),
      name: clipped(cell(row, mapping, "name"), 1_000),
      phone: phone.value,
      phoneMasked: phone.masked,
      phoneInvalid: phone.invalid,
      gender: clipped(cell(row, mapping, "gender"), 100),
      birthday: birthday.value,
      birthdayText: birthday.text.slice(0, 100),
      school: clipped(cell(row, mapping, "school"), 1_000),
      publicSchoolClass: clipped(cell(row, mapping, "publicSchoolClass"), 1_000),
      grade: grade.value,
      gradeText: grade.text.slice(0, 100),
      gradeUnmapped: grade.unmapped,
      parentName: clipped(cell(row, mapping, "parentName"), 1_000),
      parentRelation: clipped(cell(row, mapping, "parentRelation"), 200),
      parentPhone: parentPhone.value,
      parentPhoneMasked: parentPhone.masked,
      parentPhoneInvalid: parentPhone.invalid,
      remark: clipped(cell(row, mapping, "remark"), 10_000),
      source: clipped(cell(row, mapping, "source"), 1_000),
      marketActivity: clipped(cell(row, mapping, "marketActivity"), 1_000),
      tags,
    });
  }

  if (rows.length === 0) throw new MofaxiaoParseError("EMPTY_SHEET");
  return {
    headerRow: headerIndex + 1,
    recognizedHeaders: [...mapping.keys()],
    rows,
  };
}
