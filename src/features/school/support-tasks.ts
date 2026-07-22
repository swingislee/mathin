export type SupportTaskKind = "preclass_notice" | "absence_check" | "makeup_followup" | "postclass_followup" | "renewal_followup";

/** 与 class_support_tasks.status 数据库枚举同步，供其他文件复用/断言。 */
export type SupportTaskStatus = "pending" | "done" | "skipped" | "invalidated";
