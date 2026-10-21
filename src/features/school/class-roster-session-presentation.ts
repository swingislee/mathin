import type { ClassRosterSession } from "./class-roster-session-contract";
export type { ClassRosterSession } from "./class-roster-session-contract";

export function hasClassSessionStarted(session: Pick<ClassRosterSession, "startedAt" | "endedAt">) {
  return Boolean(session.startedAt || session.endedAt);
}

export const CLASS_SESSION_OBSERVATION_BATCH_SIZE = 40;


export function orderedClassSessions(sessions: readonly ClassRosterSession[], classroomId: string) {
  return sessions.filter(session => session.classroomId === classroomId)
    .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.id.localeCompare(b.id));
}


export function classSessionMessages(locale: string) {
  return locale.startsWith("en") ? {
    session: "Lesson", actions: "Actions", noSessions: "No scheduled lessons",
    open: "View / record", attendance: "Attendance", reviews: "Reviews", noDate: "Unscheduled", untitled: "Untitled lesson",
    loading: "Loading lesson…", failed: "Lesson could not be loaded.", retry: "Retry", draft: "Entries are still syncing. Resolve any row errors before switching lessons.",
    workspace: "Lesson workspace", back: "Back to classes", preparation: "Before class", prepare: "Prepare lesson", enter: "Enter classroom", viewPreparation: "View lesson preparation",
    rehearse: "Rehearse", resume: "Re-enter classroom", noAccess: "No accessible lesson is available for this link.",
    observationsLoading: "Loading responses…", observationsFailed: "Responses unavailable",
  } : {
    session: "课次", actions: "操作", noSessions: "尚未安排课次",
    open: "查看 / 登记", attendance: "考勤", reviews: "课评", noDate: "待排时间", untitled: "未命名课次",
    loading: "正在读取课次…", failed: "课次读取失败。", retry: "重试", draft: "记录正在同步，请处理行内提示后再切换课次。",
    workspace: "课次工作区", back: "返回班级", preparation: "课前准备", prepare: "备课", enter: "进入课堂", viewPreparation: "查看备课",
    rehearse: "试讲", resume: "重新进入课堂", noAccess: "此链接暂无可查看的课次。",
    observationsLoading: "正在读取答题记录…", observationsFailed: "答题记录未读到",
  };
}
