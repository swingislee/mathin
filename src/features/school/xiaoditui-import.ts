import type { XiaodituiLeadImportRow } from "./actions/types";

type WorksheetCell = unknown;

const HEADER_ALIASES = {
  childName: ["孩子姓名"],
  phone: ["手机号码"],
  gradeText: ["年级（9月开学年级）", "孩子年级"],
  interestText: ["马上预约", "预约"],
  wechatNickname: ["微信昵称"],
  submittedAt: ["提交时间"],
  sourceDuplicate: ["是否重复"],
  acquisitionMethod: ["获取方式"],
  promoter: ["推广员"],
  location: ["定位"],
  remark: ["备注"],
  orderNumber: ["订单号"],
  paymentStatus: ["支付状态"],
  paymentAt: ["支付时间"],
} as const;

type HeaderKey = keyof typeof HEADER_ALIASES;

const REQUIRED_KEYS: HeaderKey[] = ["childName", "phone", "gradeText", "interestText", "submittedAt"];
const GRADE_VALUES: Record<string, number | null> = {
  小班: null,
  中班: null,
  大班: null,
  一年级: 1,
  二年级: 2,
  三年级: 3,
  四年级: 4,
  五年级: 5,
  六年级: 6,
  七年级: 7,
  八年级: 8,
  九年级: 9,
  十年级: 10,
  十一年级: 11,
  十二年级: 12,
};

export type LeadInterestCategory = "assessment" | "activity" | "nurture" | "product_interest" | "unknown";

export interface ParsedXiaodituiWorksheet {
  headerRow: number;
  rows: XiaodituiLeadImportRow[];
  recognizedHeaders: string[];
}

export class XiaodituiParseError extends Error {
  constructor(readonly code: "EMPTY_SHEET" | "UNRECOGNIZED_HEADERS" | "MISSING_REQUIRED_HEADERS") {
    super(code);
    this.name = "XiaodituiParseError";
  }
}

function cellText(value: WorksheetCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function normalizeHeader(value: WorksheetCell): string {
  return cellText(value).replace(/\s+/g, "").replace(/[：:]/g, "");
}

function findHeaderRow(grid: readonly (readonly WorksheetCell[])[]): number {
  const aliases = new Set(Object.values(HEADER_ALIASES).flat().map(normalizeHeader));
  let bestIndex = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(grid.length, 20); index += 1) {
    const score = grid[index].reduce<number>(
      (sum, value) => sum + (aliases.has(normalizeHeader(value)) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestIndex < 0 || bestScore < REQUIRED_KEYS.length) throw new XiaodituiParseError("UNRECOGNIZED_HEADERS");
  return bestIndex;
}

function buildColumnMap(header: readonly WorksheetCell[]): Record<HeaderKey, number> {
  const normalized = header.map(normalizeHeader);
  const entries = (Object.keys(HEADER_ALIASES) as HeaderKey[]).map((key) => {
    const index = normalized.findIndex((value) => HEADER_ALIASES[key].some((alias) => normalizeHeader(alias) === value));
    return [key, index] as const;
  });
  const columns = Object.fromEntries(entries) as Record<HeaderKey, number>;
  if (REQUIRED_KEYS.some((key) => columns[key] < 0)) throw new XiaodituiParseError("MISSING_REQUIRED_HEADERS");
  return columns;
}

function valueAt(row: readonly WorksheetCell[], index: number): string {
  return index < 0 ? "" : cellText(row[index]);
}

function parseDate(value: WorksheetCell): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = cellText(value);
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (localMatch) {
    const [, year, month, day, hour, minute, second] = localMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
  }
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? text : new Date(timestamp).toISOString();
}

export function splitXiaodituiInterests(value: string): string[] {
  return [...new Set(value.split("-").map((item) => item.trim()).filter(Boolean))];
}

export function classifyXiaodituiInterest(label: string): LeadInterestCategory {
  if (/测评|诊断/.test(label)) return "assessment";
  if (/公开课|闯关赛|数独|体验课/.test(label)) return "activity";
  if (/学习资料|持续关注/.test(label)) return "nurture";
  if (/专项课|衔接班|收心课/.test(label)) return "product_interest";
  return "unknown";
}

export function parseXiaodituiWorksheet(grid: readonly (readonly WorksheetCell[])[]): ParsedXiaodituiWorksheet {
  if (grid.length === 0) throw new XiaodituiParseError("EMPTY_SHEET");
  const headerIndex = findHeaderRow(grid);
  const columns = buildColumnMap(grid[headerIndex]);
  const rows: XiaodituiLeadImportRow[] = [];

  for (let index = headerIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    if (row.every((value) => cellText(value) === "")) continue;
    const gradeText = valueAt(row, columns.gradeText);
    const interestText = valueAt(row, columns.interestText);
    const sourceDuplicate = valueAt(row, columns.sourceDuplicate);
    rows.push({
      sourceRow: index + 1,
      childName: valueAt(row, columns.childName),
      phone: valueAt(row, columns.phone),
      grade: Object.hasOwn(GRADE_VALUES, gradeText) ? GRADE_VALUES[gradeText] : null,
      gradeText,
      interestText,
      interests: splitXiaodituiInterests(interestText),
      wechatNickname: valueAt(row, columns.wechatNickname),
      submittedAt: parseDate(columns.submittedAt < 0 ? null : row[columns.submittedAt]),
      sourceDuplicate: sourceDuplicate === "重复" || sourceDuplicate.toLowerCase() === "true",
      acquisitionMethod: valueAt(row, columns.acquisitionMethod),
      promoter: valueAt(row, columns.promoter),
      location: valueAt(row, columns.location),
      remark: valueAt(row, columns.remark),
      orderNumber: valueAt(row, columns.orderNumber),
      paymentStatus: valueAt(row, columns.paymentStatus),
      paymentAt: parseDate(columns.paymentAt < 0 ? null : row[columns.paymentAt]),
    });
  }

  return {
    headerRow: headerIndex + 1,
    rows,
    recognizedHeaders: (Object.keys(columns) as HeaderKey[]).filter((key) => columns[key] >= 0),
  };
}
