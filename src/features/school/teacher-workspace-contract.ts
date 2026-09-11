export const TEACHER_WORKSPACE_DEFAULTS = {
  students: "/dashboard/students?stage=awaiting_renewal&scope=mine",
  followups: "/dashboard/followups/enrollments",
} as const;
export type TeacherWorkspace = keyof typeof TEACHER_WORKSPACE_DEFAULTS;

const FOLLOWUP_PAGES = ["leads", "communication", "assessments", "enrollments", "renewals"];
const QUERY_KEYS = new Set(["stage", "scope", "population", "reason", "detail", "q", "page", "pageSize", "fields",
  "tab", "state", "view", "status", "assignment", "queue", "cycle", "term"]);

/** 两个入口分别记住列表工作面，临时定位与对象详情继续由显式链接打开。 */
export function teacherWorkspaceLocation(pathname: string, query: string): { workspace: TeacherWorkspace; href: string } | null {
  const workspace = pathname === "/dashboard/students" ? "students"
    : FOLLOWUP_PAGES.some(page => pathname === `/dashboard/followups/${page}`) ? "followups" : null;
  if (!workspace || query.length > 20_000) return null;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()]) if (!QUERY_KEYS.has(key)) params.delete(key);
  // 学生裸入口在读取个人偏好前保持空白，避免覆盖上次位置。
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
