import { STAFF_OVERVIEW_METRICS } from "./staff-overview-contract";
import type { StaffOverviewSupportFunnelRow, StaffOverviewTeacherParticipationRow, StaffOverviewTeacherParticipationSummary } from "./staff-overview-data";

export interface OverviewStaffOption { userId: string; name: string; aliasIds?: string[] }
export type OverviewDisplayScope = "support" | "participation" | "capacity_teachers" | "capacity_grades";
export interface OverviewDisplayGroup {
  scope: OverviewDisplayScope;
  label: string;
  cookieName: string;
  options: OverviewStaffOption[];
  selectedIds: string[];
}

export function staffOverviewDisplayCookie(userId: string, scope: OverviewDisplayScope): string {
  return `mathin_overview_${scope}_${userId}`;
}

export function staffOverviewSupportCookie(userId: string): string {
  return staffOverviewDisplayCookie(userId, "support");
}

function canonicalDisplayId(value: string): string {
  const prefix = "source-staff:";
  if (!value.startsWith(prefix)) return value;
  let name = value.slice(prefix.length);
  try { name = decodeURIComponent(name); } catch { /* 兼容来源姓名中的字面百分号。 */ }
  return `${prefix}${encodeURIComponent(name)}`;
}

/** Cookie 传输编码与对象标识分别处理，兼容旧名单和服务端已解码的来源姓名。 */
export function readOverviewDisplaySelection(value?: string): string[] | "all" | undefined {
  if (!value) return undefined;
  if (value === "all") return "all";
  if (value === "none") return [];
  try {
    const decoded = /^%5b/iu.test(value) ? decodeURIComponent(value) : value;
    const ids: unknown = decoded.startsWith("[") ? JSON.parse(decoded) : decoded.split(",");
    if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && id.length > 0)) return undefined;
    return Array.from(new Set(ids.map(canonicalDisplayId)));
  } catch { return undefined; }
}

export function encodeOverviewDisplaySelection(ids: readonly string[], options: readonly OverviewStaffOption[]): string {
  const selected = Array.from(new Set(ids));
  if (options.length > 0 && selected.length === options.length && options.every(option => selected.includes(option.userId))) return "all";
  return encodeURIComponent(JSON.stringify(selected));
}

export function selectOverviewDisplayIds(options: readonly OverviewStaffOption[], defaults: readonly string[], remembered?: string) {
  const byId = new Map<string, OverviewStaffOption>();
  for (const person of options) {
    const previous = byId.get(person.userId);
    byId.set(person.userId, { ...person, aliasIds: [...new Set([...(previous?.aliasIds ?? []), ...(person.aliasIds ?? [])])] });
  }
  const directory = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  const validIds = new Set(directory.map(person => person.userId));
  const parsed = readOverviewDisplaySelection(remembered);
  const aliases = new Map(directory.flatMap(person => (person.aliasIds ?? []).map(alias => [alias, person.userId] as const)));
  const ids = (parsed === "all" ? directory.map(person => person.userId) : parsed ?? defaults).map(id => aliases.get(id) ?? id);
  return { options: directory, selectedIds: Array.from(new Set(ids.filter(id => validIds.has(id)))) };
}

/** 写入后确认浏览器已保存；同一区块的多个设置一起成功，失败时恢复原值。 */
export function saveOverviewDisplayCookies(writes: readonly { name: string; value: string | null }[], store: { cookie: string }): boolean {
  const read = (name: string) => store.cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
  const write = ({ name, value }: { name: string; value: string | null }) => {
    store.cookie = `${name}=${value ?? ""}; Path=/; Max-Age=${value === null ? 0 : 31536000}; SameSite=Lax`;
  };
  let previous: Array<{ name: string; value: string | null }> = [];
  try {
    if (writes.some(({ name, value }) => name.length + (value?.length ?? 0) + 70 > 4096)) return false;
    previous = writes.map(({ name }) => ({ name, value: read(name) }));
    for (const item of writes) {
      write(item);
      if (read(item.name) !== item.value) throw new Error("DISPLAY_COOKIE_NOT_SAVED");
    }
    return true;
  } catch {
    for (const item of previous) { try { write(item); } catch { /* 保留失败结果供界面提示重试。 */ } }
    return false;
  }
}

/** 展示名单独立于事实归属；未选人员合并后仍能与机构合计核对。 */
export function selectOverviewSupportRows(
  rows: StaffOverviewSupportFunnelRow[], directory: OverviewStaffOption[], remembered?: string,
): { options: OverviewStaffOption[]; selectedIds: string[]; rows: StaffOverviewSupportFunnelRow[] } {
  const { options, selectedIds } = selectOverviewDisplayIds([
    ...directory,
    ...rows.flatMap(row => row.userId ? [{ userId: row.userId, name: row.name }] : []),
  ], rows.flatMap(row => row.userId ? [row.userId] : []), remembered);
  const selected = new Set(selectedIds);
  const visible = rows.filter(row => row.userId !== null && selected.has(row.userId));
  for (const userId of selectedIds) {
    if (visible.some(row => row.userId === userId)) continue;
    visible.push({ key: userId, userId, name: options.find(person => person.userId === userId)!.name,
      metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, {
        current: rows.some(row => row.metrics[metric].current === null) ? null : 0,
        previous: rows.some(row => row.metrics[metric].previous === null) ? null : 0,
      }])) as StaffOverviewSupportFunnelRow["metrics"] });
  }
  const otherRows = rows.filter(row => row.userId !== null && !selected.has(row.userId));
  if (otherRows.some(row => STAFF_OVERVIEW_METRICS.some(metric => row.metrics[metric].current !== 0 || row.metrics[metric].previous !== 0))) {
    visible.push({ key: "__other__", userId: null, name: "", metrics: Object.fromEntries(STAFF_OVERVIEW_METRICS.map(metric => [metric, {
      current: otherRows.some(row => row.metrics[metric].current === null) ? null : otherRows.reduce((sum, row) => sum + row.metrics[metric].current!, 0),
      previous: otherRows.some(row => row.metrics[metric].previous === null) ? null : otherRows.reduce((sum, row) => sum + row.metrics[metric].previous!, 0),
    }])) as StaffOverviewSupportFunnelRow["metrics"] });
  }
  visible.push(...rows.filter(row => row.userId === null));
  return { options, selectedIds, rows: visible };
}

export function selectOverviewTeacherRows(
  rows: StaffOverviewTeacherParticipationRow[], directory: OverviewStaffOption[], summary: StaffOverviewTeacherParticipationSummary, remembered?: string,
) {
  const selection = selectOverviewDisplayIds([...directory, ...rows], rows.map(row => row.userId), remembered);
  const byId = new Map(rows.map(row => [row.userId, row]));
  const empty = (metric: { current: number | null; previous: number | null }) => ({
    current: metric.current === null ? null : 0, previous: metric.previous === null ? null : 0,
  });
  return { ...selection, rows: selection.selectedIds.map(userId => byId.get(userId) ?? {
    userId, name: selection.options.find(person => person.userId === userId)!.name,
    participants: empty(summary.participants), enrollments: empty(summary.enrollments),
  }) };
}
