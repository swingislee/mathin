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
