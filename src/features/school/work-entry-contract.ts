import type { StudentEntryMode, StudentStageRow } from "./student-stage-contract";

export type WorkEntryQuery = Record<string, string | string[] | undefined>;
export const CLASS_WORK_VIEWS = ["arrange", "records", "progress", "tasks", "directory"] as const;
export type ClassWorkView = typeof CLASS_WORK_VIEWS[number];

/** 通知与待办的已存地址在展示时生成当前入口；退役地址本身不提供访问或重定向。 */
export function currentWorkEntryHref(href: string): string {
  const match = href.match(/^(\/(?:zh|en))?(\/dashboard(?:\/[^?#]*)?)(\?[^#]*)?(#.*)?$/);
  if (!match) return href;
  const [, locale = "", original, search = "", hash = ""] = match;
  let path = original;
  const query = new URLSearchParams(search);
  if (path === "/dashboard/followups") path = "/dashboard/leads";
  else if (path.startsWith("/dashboard/followups/")) path = path.replace("/dashboard/followups/", "/dashboard/");
  if (path === "/dashboard/enrollments") {
    path = "/dashboard/classes"; query.set("view", "arrange");
  } else if (path === "/dashboard/teaching") {
    path = "/dashboard/classes"; if (!query.has("view")) query.set("view", "records");
  } else if (path.startsWith("/dashboard/teaching/")) path = path.replace("/dashboard/teaching/", "/dashboard/classes/");
  else if (path === "/dashboard/invitations") path = "/dashboard/communication/worklists";
  else if (path === "/dashboard/opportunities") {
    path = "/dashboard/communication"; query.set("stage", "awaiting_enrollment");
  } else if (path === "/dashboard/coordination") {
    path = "/dashboard"; query.set("view", "work");
  } else if (path === "/dashboard/management-analytics") path = "/dashboard";
  if (path === original) return href;
  return `${locale}${path}${query.size ? `?${query}` : ""}${hash}`;
}

/** 跨视图跳转使用同一参数编码，保留重复参数及明确定位。 */
export function workEntryHref(path: string, query: WorkEntryQuery = {}, overrides: Record<string, string | undefined> = {}) {
  const [pathname, existing] = path.split("?");
  const params = new URLSearchParams(existing);
  for (const [key, value] of Object.entries({ ...query, ...overrides })) {
    params.delete(key);
    if (Array.isArray(value)) value.forEach(item => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  return `${pathname}${params.size ? `?${params}` : ""}`;
}

export function classWorkHref(view: ClassWorkView, query: WorkEntryQuery = {}) {
  return workEntryHref("/dashboard/classes", query, { view,
    period: view === "records" && query.term && !query.period ? "term" : typeof query.period === "string" ? query.period : undefined,
    page: undefined, contactPage: undefined,
    // 字段筛选的列定义属于各自视图；班级、老师、期次等共同定位继续保留。
    fields: undefined, session: view === "records" && typeof query.session === "string" ? query.session : undefined });
}

export function communicationEntryMode(row: StudentStageRow): StudentEntryMode {
  if (row.stage === "awaiting_first_contact" && row.canContact) return "contact";
  if (row.stage === "awaiting_assessment" && row.canContact) return "invitation";
  if (row.stage === "awaiting_enrollment" && row.studentId && row.canWrite) return "enrollment";
  return "note";
}

export function workEntryMessages(locale: string) {
  return locale.startsWith("en") ? {
    classes: "Classes", arrange: "Classes & placement", records: "Teaching records", progress: "Completion", tasks: "My tasks",
    directory: "Class directory", communication: "Communication", worklists: "Contact worklists", stages: "Student stages",
    communicationHint: "Expand a person to record the next step. Save and continue with the next person.",
    openRecords: "Teaching records", openRenewal: "Renewal", backStages: "Stage lists",
  } : {
    classes: "班级", arrange: "班级与分班", records: "教学登记", progress: "完成情况", tasks: "我的待办",
    directory: "班级目录", communication: "沟通", worklists: "联系工作单", stages: "学生阶段",
    communicationHint: "展开学生，按当前阶段登记；保存后可继续下一位。",
    openRecords: "教学登记", openRenewal: "续班", backStages: "阶段名单",
  };
}
