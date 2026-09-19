export const TEACHER_WORKSPACE_DEFAULTS = {
  students: "/dashboard/students?scope=mine&groupBy=classroom",
  followups: "/dashboard/classes",
} as const;
export type TeacherWorkspace = keyof typeof TEACHER_WORKSPACE_DEFAULTS;

const FOLLOWUP_PAGES = ["leads", "communication", "assessments", "classes", "renewals"];
const QUERY_KEYS = new Set(["stage", "scope", "population", "reason", "detail", "q", "page", "pageSize", "fields",
  "tab", "state", "view", "status", "assignment", "queue", "cycle", "term"]);
const DIRECTORY_QUERY_KEYS = new Set(["stage", "scope", "q", "page", "pageSize", "groupBy", "group"]);

/** 名录与工作列表分别记录筛选，临时选定名单和对象详情由显式链接打开。 */
export function teacherWorkspaceLocation(pathname: string, query: string): { workspace: TeacherWorkspace; href: string } | null {
  const workspace = pathname === "/dashboard/students" ? "students"
    : FOLLOWUP_PAGES.some(page => pathname === `/dashboard/${page}`) ? "followups" : null;
  if (!workspace || query.length > 20_000) return null;
  const params = new URLSearchParams(query);
  if (params.has("students") || params.get("tab") === "recycle") return null;
  const allowed = workspace === "students" ? DIRECTORY_QUERY_KEYS : QUERY_KEYS;
  for (const key of [...params.keys()]) if (!allowed.has(key)) params.delete(key);
  if (workspace === "students" && !params.size) return null;
  return { workspace, href: `${pathname}${params.size ? `?${params}` : ""}` };
}

export function rememberedTeacherWorkspaceHref(workspace: TeacherWorkspace, raw: string | null): string {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (typeof value === "string") {
      const [pathname, query = ""] = value.split("?");
      const location = teacherWorkspaceLocation(pathname, query);
      if (location?.workspace === workspace) return location.href;
    }
  } catch { /* 无效的个人偏好回到该入口的默认页面。 */ }
  return TEACHER_WORKSPACE_DEFAULTS[workspace];
}
