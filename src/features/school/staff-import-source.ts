import { parseDelimitedText } from "./delimited-text";
import { splitStaffRoleInput } from "./staff-role-input";

export type StaffImportSourceFormat = "mathin" | "mofaxiao";

export interface StaffImportSourceRow {
  line: number;
  name: string;
  identifier: string;
  gender: string;
  sourceRoles: string[];
  sourceFormat: StaffImportSourceFormat;
  roleText: string;
}

export interface ParsedStaffImportSource {
  format: StaffImportSourceFormat;
  rows: StaffImportSourceRow[];
  sourceRoles: string[];
}

export const IGNORED_SOURCE_ROLE = "__ignore__";

const HEADER_NAMES = new Set(["name", "姓名"]);
const GENDER_HEADERS = new Set(["gender", "性别"]);
const MOFAXIAO_GENDER_VALUES = new Set(["男", "女", "未知", "保密", "未设置", "--", "-"]);

/** Conservative defaults for exact 魔法校岗位 labels. Unknown labels require an explicit UI choice. */
export const MOFAXIAO_DEFAULT_ROLE_MAP: Readonly<Record<string, string>> = {
  "面授（直播）主讲": "teacher",
  "面授(直播)主讲": "teacher",
  "教务": "registrar",
  "招生": "sales",
  "学管师": "sales",
  "课程顾问": "sales",
  "校区主管": "director",
  "直播助教": "part_time",
};

function isMarkdownSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/u.test(cell.trim()));
}

function splitMofaxiaoRoles(value: string): string[] {
  return [...new Set(value.split(/[,，、]+/u).map((role) => role.trim()).filter(Boolean))];
}

function looksLikeMofaxiaoRow(cells: string[]): boolean {
  return cells.length >= 4 && MOFAXIAO_GENDER_VALUES.has((cells[2] ?? "").trim());
}

export function parseStaffImportSource(text: string): ParsedStaffImportSource {
  const records = parseDelimitedText(text).filter((record) => !isMarkdownSeparator(record.cells));
  const first = records[0];
  const hasHeader = first ? HEADER_NAMES.has((first.cells[0] ?? "").trim().toLowerCase()) : false;
  const headerIsMofaxiao = Boolean(
    hasHeader && GENDER_HEADERS.has((first?.cells[2] ?? "").trim().toLowerCase()),
  );
  const body = hasHeader ? records.slice(1) : records;
  const format: StaffImportSourceFormat = headerIsMofaxiao || body.some((record) => looksLikeMofaxiaoRow(record.cells))
    ? "mofaxiao"
    : "mathin";

  const rows = body.map((record): StaffImportSourceRow => {
    const name = (record.cells[0] ?? "").trim();
    const identifier = (record.cells[1] ?? "").trim();
    if (format === "mofaxiao") {
      const roleText = record.cells.slice(3).join(",");
      return {
        line: record.line,
        name,
        identifier,
        gender: (record.cells[2] ?? "").trim(),
        sourceRoles: splitMofaxiaoRoles(roleText),
        sourceFormat: format,
        roleText,
      };
    }
    const roleText = record.cells.slice(2).join(",");
    return {
      line: record.line,
      name,
      identifier,
      gender: "",
      sourceRoles: splitStaffRoleInput(roleText),
      sourceFormat: format,
      roleText,
    };
  });

  return {
    format,
    rows,
    sourceRoles: format === "mofaxiao"
      ? [...new Set(rows.flatMap((row) => row.sourceRoles))]
      : [],
  };
}

export function initialMofaxiaoRoleMappings(sourceRoles: string[]): Record<string, string> {
  return Object.fromEntries(sourceRoles.map((role) => [role, MOFAXIAO_DEFAULT_ROLE_MAP[role] ?? ""]));
}

export function mapMofaxiaoRoles(
  sourceRoles: string[],
  mappings: Readonly<Record<string, string>>,
): { roles: string[]; unresolved: string[] } {
  const roles: string[] = [];
  const unresolved: string[] = [];
  for (const sourceRole of sourceRoles) {
    const target = mappings[sourceRole] ?? "";
    if (!target) unresolved.push(sourceRole);
    else if (target !== IGNORED_SOURCE_ROLE && !roles.includes(target)) roles.push(target);
  }
  return { roles, unresolved };
}
