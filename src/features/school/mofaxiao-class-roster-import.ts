import type {
  ClassRosterStudentOption,
  ClassRosterTargetOption,
  MofaxiaoClassRosterDefaultClass,
} from "./actions/types";

type WorksheetCell = unknown;

export interface RosterWorkbookSheet {
  sheet: string;
  data: readonly (readonly WorksheetCell[])[];
}

export interface ParsedMofaxiaoRosterStudent {
  sourceRow: number;
  sourceCell: string;
  rawName: string;
  name: string;
  phone: string;
  sourceNote: string;
  needsReview: boolean;
}

export interface ParsedMofaxiaoRosterClass {
  sourceRow: number;
  sourceClassKey: string;
  sourceClassLabel: string;
  campus: string;
  system: string;
  grade: number | null;
  gradeText: string;
  season: number;
  seasonText: string;
  classType: string;
  room: string;
  teacher: string;
  weekday: string;
  time: string;
  students: ParsedMofaxiaoRosterStudent[];
}

export interface ParsedMofaxiaoClassRosterWorkbook {
  sheetName: string;
  schoolYear: number;
  season: number;
  classes: ParsedMofaxiaoRosterClass[];
  memberships: number;
  registrationIdentityCount: number;
}

export type MofaxiaoClassRosterParseErrorCode =
  | "EMPTY_WORKBOOK"
  | "MISSING_ROSTER_SHEET"
  | "EMPTY_AUTUMN_ROSTER";

export class MofaxiaoClassRosterParseError extends Error {
  constructor(public readonly code: MofaxiaoClassRosterParseErrorCode) {
    super(code);
    this.name = "MofaxiaoClassRosterParseError";
  }
}

export type RosterStudentMatchKind = "exact_phone" | "unique_name" | "ambiguous_name" | "new" | "review";

const AIXUEXI_PRIMARY_MATH_FAMILY = "aixuexi-primary-math";
const MOFAXIAO_E_SERIES_FAMILY = "xueersi-e-primary-math-cn";
const INTEGRATED_THINKING_LEVELS = new Set(["G+", "A+"]);
const E_SERIES_SYSTEM_HINTS = ["培优", "科学"];

export interface RosterStudentMatch {
  kind: RosterStudentMatchKind;
  suggestedStudentId: string | null;
  candidates: ClassRosterStudentOption[];
}

export interface RosterStudentDefaultDecision {
  decision: "link_existing" | "create_student" | "pending";
  studentId: string | null;
}

function textOf(value: WorksheetCell): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/^\uFEFF/, "").trim();
}

export function normalizeRosterText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s\u3000]+/g, "");
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^86[1-9]\d{10}$/.test(digits) ? digits.slice(2) : digits;
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function parseGrade(value: string): number | null {
  const compact = value.replace(/\s+/g, "");
  const numeric = compact.match(/^(\d{1,2})年级$/);
  if (numeric) return Number(numeric[1]);
  const words = new Map([
    ["一年级", 1], ["二年级", 2], ["三年级", 3], ["四年级", 4], ["五年级", 5], ["六年级", 6],
    ["七年级", 7], ["八年级", 8], ["九年级", 9],
  ]);
  return words.get(compact) ?? null;
}

function parseStudentCell(rawValue: string): { name: string; sourceNote: string; needsReview: boolean } {
  const raw = rawValue.trim();
  const reviewTokens = ["待定", "未进班", "拟退费", "退费", "不愿意", "不来", "去方田"];
  const reviewToken = reviewTokens.find((token) => raw.includes(token));
  if (reviewToken) {
    const name = raw.replace(reviewToken, "").replace(/[（(].*?[）)]/g, "").trim() || raw;
    return { name, sourceNote: reviewToken, needsReview: true };
  }
  const parentheticalSuffix = raw.match(/^(.+?)[（(]([^）)]+)[）)]$/u);
  if (parentheticalSuffix) {
    return {
      name: parentheticalSuffix[1].trim(),
      sourceNote: parentheticalSuffix[2].trim(),
      needsReview: true,
    };
  }
  if (/[（(].+[）)]/.test(raw)) return { name: raw, sourceNote: raw, needsReview: true };
  return { name: raw, sourceNote: "", needsReview: false };
}

function registrationPhones(sheets: readonly RosterWorkbookSheet[]): { phonesByName: Map<string, string>; identities: number } {
  const registration = sheets.find((sheet) => normalizeRosterText(sheet.sheet) === normalizeRosterText("学员报名信息"));
  if (!registration) return { phonesByName: new Map(), identities: 0 };
  const pairs = new Map<string, Set<string>>();
  const identities = new Set<string>();
  for (let index = 2; index < registration.data.length; index += 1) {
    const row = registration.data[index];
    const name = textOf(row[1]);
    const phone = normalizePhone(textOf(row[2]));
    if (!name || name === "学员姓名" || !phone) continue;
    const key = normalizeRosterText(name);
    identities.add(`${key}\u0000${phone}`);
    const values = pairs.get(key) ?? new Set<string>();
    values.add(phone);
    pairs.set(key, values);
  }
  const phonesByName = new Map<string, string>();
  for (const [name, phones] of pairs) {
    if (phones.size === 1) phonesByName.set(name, [...phones][0]);
  }
  return { phonesByName, identities: identities.size };
}

function rosterClassBaseKey(input: {
  campus: string;
  system: string;
  gradeText: string;
  seasonText: string;
  classType: string;
  room: string;
  teacher: string;
  weekday: string;
  time: string;
}) {
  return [
    "2026", "autumn", input.campus, input.system, input.gradeText, input.seasonText,
    input.classType, input.room, input.teacher, input.weekday, input.time,
  ].map(normalizeRosterText).join("::").slice(0, 200);
}

export function parseMofaxiaoClassRosterWorkbook(
  sheets: readonly RosterWorkbookSheet[],
): ParsedMofaxiaoClassRosterWorkbook {
  if (sheets.length === 0) throw new MofaxiaoClassRosterParseError("EMPTY_WORKBOOK");
  const roster = sheets.find((sheet) => normalizeRosterText(sheet.sheet) === normalizeRosterText("26年暑秋在读学员"));
  if (!roster) throw new MofaxiaoClassRosterParseError("MISSING_ROSTER_SHEET");

  const { phonesByName, identities } = registrationPhones(sheets);
  const classes: ParsedMofaxiaoRosterClass[] = [];
  const keyCounts = new Map<string, number>();
  let campus = "";
  let system = "";
  const start = 29; // AD: autumn class metadata begins here.
  const studentStart = 40; // AO
  const studentEnd = 59; // BH

  for (let index = 0; index < roster.data.length; index += 1) {
    const row = roster.data[index];
    const first = textOf(row[start]);
    const seasonText = textOf(row[start + 1]);
    if (["利港", "紫辰", "紫辰阁"].includes(first)) campus = first === "紫辰阁" ? "紫辰" : first;
    if (first.endsWith("体系") || ["思维", "英语", "速算", "人文"].includes(first)) system = first;
    const grade = parseGrade(first);
    if (grade === null || !/^秋/.test(seasonText)) continue;

    const classType = textOf(row[start + 2]);
    const room = textOf(row[start + 3]);
    const teacher = textOf(row[start + 4]);
    const weekday = textOf(row[start + 5]);
    const time = textOf(row[start + 6]);
    const baseKey = rosterClassBaseKey({ campus, system, gradeText: first, seasonText, classType, room, teacher, weekday, time });
    const occurrence = (keyCounts.get(baseKey) ?? 0) + 1;
    keyCounts.set(baseKey, occurrence);
    const sourceClassKey = occurrence === 1 ? baseKey : `${baseKey.slice(0, 180)}::row:${index + 1}`;
    const students: ParsedMofaxiaoRosterStudent[] = [];
    for (let cellIndex = studentStart; cellIndex <= studentEnd; cellIndex += 1) {
      const rawName = textOf(row[cellIndex]);
      if (!rawName) continue;
      const parsed = parseStudentCell(rawName);
      students.push({
        sourceRow: index + 1,
        sourceCell: `${columnName(cellIndex)}${index + 1}`,
        rawName,
        name: parsed.name,
        phone: phonesByName.get(normalizeRosterText(parsed.name)) ?? "",
        sourceNote: parsed.sourceNote,
        needsReview: parsed.needsReview,
      });
    }
    if (students.length === 0) continue;
    classes.push({
      sourceRow: index + 1,
      sourceClassKey,
      sourceClassLabel: [campus, first, seasonText, classType, teacher, weekday, time].filter(Boolean).join(" · "),
      campus,
      system,
      grade,
      gradeText: first,
      season: 2,
      seasonText,
      classType,
      room,
      teacher,
      weekday,
      time,
      students,
    });
  }
  if (classes.length === 0) throw new MofaxiaoClassRosterParseError("EMPTY_AUTUMN_ROSTER");
  return {
    sheetName: roster.sheet,
    schoolYear: 2026,
    season: 2,
    classes,
    memberships: classes.reduce((total, item) => total + item.students.length, 0),
    registrationIdentityCount: identities,
  };
}

export function matchMofaxiaoRosterStudent(
  student: ParsedMofaxiaoRosterStudent,
  options: readonly ClassRosterStudentOption[],
): RosterStudentMatch {
  const nameKey = normalizeRosterText(student.name);
  const candidates = options.filter((option) => normalizeRosterText(option.name) === nameKey);
  const phoneKey = normalizePhone(student.phone);
  const phoneCandidates = phoneKey
    ? candidates.filter((option) => [option.phone, option.parentPhone].some((value) => normalizePhone(value) === phoneKey))
    : [];
  const suggested = phoneCandidates.length === 1 ? phoneCandidates[0]
    : candidates.length === 1 ? candidates[0]
    : null;
  if (student.needsReview) return { kind: "review", suggestedStudentId: suggested?.id ?? null, candidates };
  if (phoneCandidates.length === 1) return { kind: "exact_phone", suggestedStudentId: phoneCandidates[0].id, candidates: phoneCandidates };
  if (candidates.length === 1) return { kind: "unique_name", suggestedStudentId: candidates[0].id, candidates };
  if (candidates.length > 1) return { kind: "ambiguous_name", suggestedStudentId: null, candidates };
  return { kind: "new", suggestedStudentId: null, candidates: [] };
}

export function defaultMofaxiaoRosterStudentDecision(
  match: RosterStudentMatch,
  canCreateStudents: boolean,
): RosterStudentDefaultDecision {
  if (
    (match.kind === "exact_phone" || match.kind === "unique_name" || match.kind === "review")
    && match.suggestedStudentId
  ) {
    return { decision: "link_existing", studentId: match.suggestedStudentId };
  }
  if (
    canCreateStudents
    && (match.kind === "new" || (match.kind === "review" && match.candidates.length === 0))
  ) {
    return { decision: "create_student", studentId: null };
  }
  return { decision: "pending", studentId: null };
}

function targetScore(source: ParsedMofaxiaoRosterClass, target: ClassRosterTargetOption): number {
  let score = 0;
  const targetText = normalizeRosterText([target.name, target.courseTitle, target.courseClassType].join(" "));
  if (target.schoolYear === 2026 && target.season === 2) score += 4;
  if (target.grade === source.grade) score += 4;
  if (source.teacher && target.primaryTeacherNames.some((name) => normalizeRosterText(name) === normalizeRosterText(source.teacher))) score += 3;
  if (targetMatchesSourceCampus(source, target)) score += 2;
  const expectedCourseClassType = mofaxiaoRosterCourseClassType(source);
  if (source.classType && (
    normalizeRosterText(target.courseClassType) === normalizeRosterText(expectedCourseClassType)
    || (!isMofaxiaoESeriesRosterSource(source) && targetText.includes(normalizeRosterText(source.classType)))
  )) score += 2;
  if (source.weekday && normalizeRosterText(target.name).includes(normalizeRosterText(source.weekday))) score += 1;
  const sourceStartTime = normalizedStartTime(source.time);
  if (sourceStartTime && normalizedStartTime(target.name) === sourceStartTime) score += 1;
  return score;
}

function normalizedStartTime(value: string): string {
  const match = value.match(/(\d{1,2}):(\d{2})/);
  return match ? `${Number(match[1])}:${match[2]}` : "";
}

function normalizedCampusKey(value: string): string {
  const normalized = normalizeRosterText(value);
  if (normalized.includes("紫辰")) return "紫辰阁";
  if (normalized.includes("利港")) return "利港";
  return normalized;
}

function targetMatchesSourceCampus(source: ParsedMofaxiaoRosterClass, target: ClassRosterTargetOption): boolean {
  const sourceCampus = normalizedCampusKey(source.campus);
  return Boolean(sourceCampus) && (
    normalizedCampusKey(target.campusName) === sourceCampus
    || normalizedCampusKey(target.name) === sourceCampus
  );
}

function targetMatchesSourceSchedule(source: ParsedMofaxiaoRosterClass, target: ClassRosterTargetOption): boolean {
  const targetName = normalizeRosterText(target.name);
  const weekday = normalizeRosterText(source.weekday);
  const startTime = normalizedStartTime(source.time);
  return Boolean(weekday) && targetName.includes(weekday)
    && Boolean(startTime) && normalizedStartTime(target.name) === startTime;
}

function isMofaxiaoESeriesRosterSource(source: ParsedMofaxiaoRosterClass): boolean {
  const system = normalizeRosterText(source.system);
  return E_SERIES_SYSTEM_HINTS.some((hint) => system.includes(hint));
}

export function canonicalMofaxiaoRosterClassType(source: ParsedMofaxiaoRosterClass): string {
  return source.classType.trim().toUpperCase();
}

/** Mofaxiao E-series A+ is the business class type but uses the B textbook. */
export function mofaxiaoRosterCourseClassType(source: ParsedMofaxiaoRosterClass): string {
  const classType = canonicalMofaxiaoRosterClassType(source);
  return isMofaxiaoESeriesRosterSource(source) && classType === "A+"
    ? "B"
    : classType;
}

function compactNamePart(value: string, fallback: string): string {
  return value.normalize("NFKC").replace(/[\s\u3000]+/g, "").trim() || fallback;
}

const PINYIN_COLLATOR = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
});
const PINYIN_INITIAL_ANCHORS = [
  ["A", "阿"], ["B", "八"], ["C", "嚓"], ["D", "咑"], ["E", "妸"], ["F", "发"],
  ["G", "旮"], ["H", "哈"], ["J", "丌"], ["K", "咔"], ["L", "垃"], ["M", "妈"],
  ["N", "拿"], ["O", "哦"], ["P", "啪"], ["Q", "期"], ["R", "然"], ["S", "撒"],
  ["T", "他"], ["W", "挖"], ["X", "昔"], ["Y", "压"], ["Z", "匝"],
] as const;
const HAN_CHARACTER = /^\p{Script=Han}$/u;
const ASCII_LETTER = /^[A-Za-z]$/;
const ASCII_DIGIT = /^\d$/;

function pinyinInitial(character: string): string {
  let result = "";
  for (const [initial, anchor] of PINYIN_INITIAL_ANCHORS) {
    if (PINYIN_COLLATOR.compare(character, anchor) < 0) break;
    result = initial;
  }
  return result || character;
}

/** Compact a teacher name to uppercase pinyin initials for the class display name. */
export function teacherInitialsForClassName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return "";
  if (/^[A-Z]+$/.test(normalized)) return normalized;

  let result = "";
  let insideLatinWord = false;
  for (const character of normalized) {
    if (HAN_CHARACTER.test(character)) {
      result += pinyinInitial(character);
      insideLatinWord = false;
    } else if (ASCII_LETTER.test(character)) {
      if (!insideLatinWord) result += character.toUpperCase();
      insideLatinWord = true;
    } else if (ASCII_DIGIT.test(character)) {
      result += character;
      insideLatinWord = false;
    } else {
      insideLatinWord = false;
    }
  }
  return result || compactNamePart(normalized, "").toUpperCase();
}

function canonicalRosterCampusName(value: string): string {
  const compact = compactNamePart(value, "待定校区");
  return compact.includes("紫辰") ? "紫辰阁" : compact;
}

function canonicalRosterSeriesName(value: string): string {
  const compact = compactNamePart(value.replace(/体系$/u, ""), "待定系列");
  if (compact.includes("贯通")) return "贯通思维";
  if (compact.includes("培优") || compact.includes("科学")) return "科学思维";
  return compact;
}

/** Build the fixed 【系列】年级季节班型｜校区老师星期时间 class shell. */
export function buildMofaxiaoRosterDefaultClass(
  source: ParsedMofaxiaoRosterClass,
  schoolYear = 2026,
): MofaxiaoClassRosterDefaultClass {
  const system = canonicalRosterSeriesName(source.system);
  const gradeText = compactNamePart(source.gradeText, "待定年级");
  const seasonText = compactNamePart(source.seasonText, source.season === 2 ? "秋季" : "待定季节");
  const classType = compactNamePart(canonicalMofaxiaoRosterClassType(source), "待定班型");
  const courseClassType = compactNamePart(mofaxiaoRosterCourseClassType(source), classType);
  const campusName = canonicalRosterCampusName(source.campus);
  const teacherInitials = teacherInitialsForClassName(source.teacher) || "待定老师";
  const weekday = compactNamePart(source.weekday, "待定星期");
  const time = compactNamePart(source.time, "待定时间");
  const name = `【${system}】${gradeText}${seasonText}${classType}｜${campusName}${teacherInitials}${weekday}${time}`.slice(0, 100);
  return {
    name,
    system,
    schoolYear,
    season: source.season,
    seasonText,
    grade: source.grade,
    gradeText,
    classType,
    courseClassType,
    campusName,
    roomName: source.room.trim(),
    teacherName: source.teacher.trim(),
    teacherInitials,
    weekday: source.weekday.trim(),
    time: source.time.trim(),
  };
}

function targetMatchesSourceSystem(source: ParsedMofaxiaoRosterClass, target: ClassRosterTargetOption): boolean {
  if (normalizeRosterText(source.system).includes("贯通")) {
    return target.courseFamilySlug === AIXUEXI_PRIMARY_MATH_FAMILY
      && INTEGRATED_THINKING_LEVELS.has(target.courseClassType.trim().toUpperCase());
  }
  if (isMofaxiaoESeriesRosterSource(source)) {
    return target.courseFamilySlug === MOFAXIAO_E_SERIES_FAMILY
      && target.courseClassType.trim().toUpperCase() === mofaxiaoRosterCourseClassType(source);
  }
  return true;
}

function isHighConfidenceTarget(source: ParsedMofaxiaoRosterClass, target: ClassRosterTargetOption): boolean {
  const integratedThinking = normalizeRosterText(source.system).includes("贯通");
  const eSeries = isMofaxiaoESeriesRosterSource(source);
  const teacherMatches = Boolean(source.teacher) && target.primaryTeacherNames
    .some((name) => normalizeRosterText(name) === normalizeRosterText(source.teacher));
  return target.schoolYear === 2026
    && target.season === 2
    && source.grade !== null
    && target.grade === source.grade
    && teacherMatches
    && targetMatchesSourceCampus(source, target)
    && (!eSeries || targetMatchesSourceSchedule(source, target))
    && (integratedThinking
      || normalizeRosterText(target.courseClassType) === normalizeRosterText(mofaxiaoRosterCourseClassType(source)));
}

export function listMofaxiaoRosterClassCandidates(
  source: ParsedMofaxiaoRosterClass,
  targets: readonly ClassRosterTargetOption[],
): ClassRosterTargetOption[] {
  return targets
    .filter((target) => targetMatchesSourceSystem(source, target)
      && (target.schoolYear === null || target.schoolYear === 2026)
      && (target.season === null || target.season === 2)
      && (target.grade === null || source.grade === null || target.grade === source.grade))
    .sort((left, right) => targetScore(source, right) - targetScore(source, left)
      || left.name.localeCompare(right.name, "zh-CN"));
}

export function preferredMofaxiaoRosterClassCandidate(
  source: ParsedMofaxiaoRosterClass,
  targets: readonly ClassRosterTargetOption[],
): ClassRosterTargetOption | null {
  const candidates = listMofaxiaoRosterClassCandidates(source, targets);
  if (candidates.length === 0) return null;
  const firstScore = targetScore(source, candidates[0]);
  const secondScore = candidates[1] ? targetScore(source, candidates[1]) : -1;
  return isHighConfidenceTarget(source, candidates[0]) && firstScore >= 12 && firstScore > secondScore
    ? candidates[0]
    : null;
}
