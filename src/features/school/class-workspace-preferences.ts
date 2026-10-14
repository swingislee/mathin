import { CLASS_WORK_VIEWS, type WorkEntryQuery } from "./work-entry-contract";
import type { EnrollmentPlacementBoard } from "./enrollment-workflow-contract";

export const CLASS_WORKSPACE_PREFERENCE = "workspace-entry:classes";
export type ClassRosterScope = "mine" | "all";
const KEYS = ["view", "scope", "group", "term", "q", "fields", "period", "date", "teacher", "classroom",
  "teacherId", "supportId", "grade", "schoolTermId", "operationalStatus", "purpose", "readiness"];

/** 仅使用服务端已有任课关系，并与当前可用班级相交。 */
export function myRosterClassroomIds(board: EnrollmentPlacementBoard): Set<string> {
  const teaching = new Set(board.access?.teacherClassroomIds ?? []);
  return new Set(board.options.classrooms.filter(row => teaching.has(row.id)).map(row => row.id));
}

export function classRosterScope(requested: WorkEntryQuery["scope"], hasClasses: boolean, focused = false): ClassRosterScope {
  if (!hasClasses || requested === "all") return "all";
  if (requested === "mine") return "mine";
  return focused ? "all" : "mine";
}

/** 记住班级入口的展示选择；课次与学生定位由本次显式链接处理。 */
export function classWorkspacePreference(query: WorkEntryQuery): string | null {
  if (query.session || query.student || query.replay) return null;
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = query[key];
    if (typeof value === "string" && value.length <= (key === "fields" ? 12_000 : 200)) params.set(key, value);
  }
  const view = params.get("view");
  if (!CLASS_WORK_VIEWS.some(value => value === view) || view === "records") params.set("view", "arrange");
  return params.toString();
}

export function rememberedClassWorkspaceHref(raw: string | null): string {
  let query: WorkEntryQuery = {};
  try {
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (typeof saved === "string" && saved.length <= 20_000) query = Object.fromEntries(new URLSearchParams(saved));
  } catch { /* 无效偏好使用当前账号的默认班级范围。 */ }
  return `/dashboard/classes?${classWorkspacePreference(query) ?? "view=arrange"}`;
}

/** 同一选择镜像到 Cookie，裸入口在服务端直接进入目标视图；值带账号，换号登录不串用。 */
export const CLASS_WORKSPACE_COOKIE = "mathin_class_workspace";
const CLASS_WORKSPACE_COOKIE_MAX = 3_000;

export function classWorkspaceCookieValue(userId: string, preference: string): string | null {
  const value = `${userId}|${preference}`;
  return value.length <= CLASS_WORKSPACE_COOKIE_MAX ? value : null;
}

export function classWorkspaceHrefFromCookie(value: string | undefined, userId: string): string | null {
  if (!value || value.length > CLASS_WORKSPACE_COOKIE_MAX) return null;
  const separator = value.indexOf("|");
  if (separator < 0 || value.slice(0, separator) !== userId) return null;
  const preference = classWorkspacePreference(Object.fromEntries(new URLSearchParams(value.slice(separator + 1))));
  return preference ? `/dashboard/classes?${preference}` : null;
}
