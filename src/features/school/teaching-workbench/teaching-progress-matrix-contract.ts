import { LEARNING_CHECK_STATUS_STYLE } from "../session-learning-visual";

export const TEACHING_PROGRESS_ITEMS = [
  "solution", "lesson_plan", "rehearsal_video", "learning", "class_feedback", "homework", "communication", "reflection",
] as const;
export type TeachingProgressItem = typeof TEACHING_PROGRESS_ITEMS[number];
export const TEACHING_PROGRESS_STATES = ["incomplete", "overdue", "overdue_review", "overdue_archived", "review", "archived"] as const;
export type TeachingProgressState = typeof TEACHING_PROGRESS_STATES[number] | "unavailable";
export type TeachingProgress = {
  state: TeachingProgressState;
  reason: "missing" | "draft" | "pending" | "approved" | "changes_requested" | "done" | "skipped" | "follow_up" | "recorded" | "after_class" | "reflection_empty" | "reflection_unreviewed" | "forbidden" | "failed" | "published" | "unpublished" | "timing_missing";
  dueAt?: string | null; completedAt?: string | null;
};
export type TeachingProgressClass = {
  id: string; name: string; termId: string | null; grade: number | null; courseTitle: string; level: string;
  campus: string | null; room: string; teachers: { id: string; name: string }[];
};
export type TeachingProgressSession = {
  id: string; classroomId: string; title: string; lectureNo: number | null;
  scheduledAt: string | null; duration: number | null; startedAt: string | null; endedAt: string | null;
  teacherOverride: { id: string; name: string } | null;
  progress: Record<TeachingProgressItem, TeachingProgress>;
};
export type TeachingProgressMatrixData = { classrooms: TeachingProgressClass[]; sessions: TeachingProgressSession[] };
export type TeachingProgressTerm = { id: string; name: string; isCurrent: boolean; startsOn: string | null; endsOn: string | null };

/** 图标文字与填充色块复用现有班级学情色。 */
export const TEACHING_PROGRESS_TONES: Record<TeachingProgressState, string> = {
  incomplete: LEARNING_CHECK_STATUS_STYLE.unchecked.icon, overdue: LEARNING_CHECK_STATUS_STYLE.incomplete.icon,
  overdue_review: LEARNING_CHECK_STATUS_STYLE.imitated.icon, overdue_archived: LEARNING_CHECK_STATUS_STYLE.prompted.icon,
  review: LEARNING_CHECK_STATUS_STYLE.independent.icon, archived: LEARNING_CHECK_STATUS_STYLE.explained.icon,
  unavailable: LEARNING_CHECK_STATUS_STYLE.unchecked.icon,
};
export const TEACHING_PROGRESS_BLOCK_TONES: Record<TeachingProgressState, string> = {
  incomplete: LEARNING_CHECK_STATUS_STYLE.unchecked.active, overdue: LEARNING_CHECK_STATUS_STYLE.incomplete.active,
  overdue_review: LEARNING_CHECK_STATUS_STYLE.imitated.active, overdue_archived: LEARNING_CHECK_STATUS_STYLE.prompted.active,
  review: LEARNING_CHECK_STATUS_STYLE.independent.active, archived: LEARNING_CHECK_STATUS_STYLE.explained.active,
  unavailable: "border-dashed border-line bg-card text-muted",
};

/** 迟交由本次完成时间决定；按时提交后的审核等待不会变成逾期。 */
export function timedTeachingProgress(progress: TeachingProgress, { dueAt = null, completedAt = null, now }: {
  dueAt?: string | null; completedAt?: string | null; now: number;
}): TeachingProgress {
  const deadline = dueAt === null ? null : Date.parse(dueAt);
  const completed = completedAt === null ? null : Date.parse(completedAt);
  const timing = { dueAt, completedAt };
  if (progress.state === "unavailable") return { ...progress, ...timing };
  if (deadline !== null && !Number.isFinite(deadline)) return { ...timing, state: "unavailable", reason: "timing_missing" };
  if (progress.state === "incomplete") return { ...progress, ...timing, state: deadline !== null && now > deadline ? "overdue" : "incomplete" };
  if (progress.state === "review" || progress.state === "archived") {
    if (deadline !== null && (completed === null || !Number.isFinite(completed))) return { ...timing, state: "unavailable", reason: "timing_missing" };
    const late = deadline !== null && completed !== null && completed > deadline;
    return { ...progress, ...timing, state: late ? progress.state === "archived" ? "overdue_archived" : "overdue_review" : progress.state };
  }
  return { ...progress, ...timing };
}

export function artifactProgress(status?: string | null): TeachingProgress {
  if (status === "approved") return { state: "archived", reason: "approved" };
  if (status === "pending") return { state: "review", reason: "pending" };
  return { state: "incomplete", reason: status === "changes_requested" ? "changes_requested" : status === "draft" ? "draft" : "missing" };
}

/** 完成记录进入待审核；跳过任务保留为独立事实。 */
export function completionProgress(status?: string | null): TeachingProgress {
  return status === "done" ? { state: "review", reason: "done" }
    : { state: "incomplete", reason: status === "skipped" ? "skipped" : "missing" };
}

export function classFeedbackProgress(outcome?: string | null): TeachingProgress {
  return outcome === "contacted" ? { state: "review", reason: "recorded" }
    : { state: "incomplete", reason: outcome === "follow_up" ? "follow_up" : outcome === "not_needed" ? "skipped" : "missing" };
}

/** 全名单成果发布后完成，真实审核记录决定已审核；旧 reviews 任务不代表逐生覆盖。 */
export function learningProgress(statuses: readonly string[], reviewed = false): TeachingProgress {
  if (!statuses.length || statuses.includes("missing")) return { state: "incomplete", reason: "missing" };
  if (statuses.some(status => !["published", "review"].includes(status))) return { state: "incomplete", reason: "unpublished" };
  if (statuses.includes("review")) return { state: "review", reason: "pending" };
  return { state: reviewed ? "archived" : "review", reason: "published" };
}

function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(blockText).join("");
  if (!value || typeof value !== "object") return "";
  const block = value as Record<string, unknown>;
  return typeof block.text === "string" ? block.text : blockText(block.content);
}

const REFLECTION_PROMPTS = ["学生实际表现", "本节课有效的地方", "本节课需要调整的地方", "下节课需要调整的地方", "是否需要更新学情版本"];

/** 默认模板的标题与提示语不算反思；只读取反思章节，不把其他教学正文算进去。 */
export function hasLessonReflection(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  let reflectionLevel: number | null = null;
  for (const value of content) {
    if (!value || typeof value !== "object") continue;
    const block = value as { type?: string; props?: { level?: number }; children?: unknown[] };
    const text = blockText(value).trim();
    if (block.type === "heading") {
      const level = block.props?.level ?? 1;
      if (/课后反思|post[- ](?:lesson|class) reflection/i.test(text)) { reflectionLevel = level; continue; }
      if (reflectionLevel !== null && level <= reflectionLevel) reflectionLevel = null;
    }
    if (reflectionLevel === null) continue;
    const meaningful = [text, ...(block.children ?? []).map(blockText)].some(part => {
      let answer = part.trim();
      for (const prompt of REFLECTION_PROMPTS) if (answer.startsWith(prompt)) answer = answer.slice(prompt.length).replace(/^\s*[:：]\s*/, "").trim();
      return Boolean(answer && !/^[.。…\s＿_—-]+$/.test(answer));
    });
    if (meaningful) return true;
  }
  return false;
}

export function reflectionProgress(endedAt: string | null, plan?: { content: unknown; status: string } | null): TeachingProgress {
  if (!endedAt) return { state: "incomplete", reason: "after_class" };
  if (!plan || !hasLessonReflection(plan.content)) return { state: "incomplete", reason: "reflection_empty" };
  return artifactProgress(plan.status);
}

/** 使用实际讲号对齐，保留补课/重讲；无讲号课次单列，避免按日期错配不同班级的讲次。 */
export function teachingMatrixColumns(sessions: readonly TeachingProgressSession[]) {
  const numbers = [...new Set(sessions.flatMap(session => session.lectureNo === null ? [] : [session.lectureNo]))].sort((a, b) => a - b);
  return [...numbers.map(number => ({ key: `lecture:${number}`, lectureNo: number })),
    ...(sessions.some(session => session.lectureNo === null) ? [{ key: "unspecified", lectureNo: null }] : [])];
}

export function teachingMatrixSessions(sessions: readonly TeachingProgressSession[], classroomId: string, lectureNo: number | null) {
  return sessions.filter(session => session.classroomId === classroomId && session.lectureNo === lectureNo)
    .sort((a, b) => (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") || a.id.localeCompare(b.id));
}

export function teachingMatrixTeachers(row: TeachingProgressClass, sessions: readonly TeachingProgressSession[]) {
  const people = row.teachers.map(person => ({ ...person, substitute: false }));
  for (const session of sessions) {
    const person = session.teacherOverride;
    if (session.classroomId === row.id && person && !people.some(item => item.id === person.id)) people.push({ ...person, substitute: true });
  }
  return people;
}

export function teachingMatrixMessages(locale: string) {
  const en = locale.startsWith("en");
  return {
    title: en ? "Learning progress" : "学情进度", campus: en ? "Campus" : "校区", time: en ? "Time" : "时间",
    teacher: en ? "Teacher" : "老师", level: en ? "Level" : "难度", grade: en ? "Grade" : "年级", classroom: en ? "Class" : "班级",
    items: en ? { solution: "Solutions", lesson_plan: "Lesson plan", rehearsal_video: "Rehearsal", learning: "Learning", class_feedback: "Class feedback", homework: "Homework", communication: "1:1 contact", reflection: "Post-class reflection" }
      : { solution: "解析", lesson_plan: "教案", rehearsal_video: "练课", learning: "学情", class_feedback: "班群反馈", homework: "作业", communication: "沟通", reflection: "课后反思" },
    states: en ? { incomplete: "Not started", overdue: "Overdue · incomplete", overdue_review: "Completed late · awaiting review", overdue_archived: "Completed late · approved", review: "Completed · awaiting review", archived: "Approved", unavailable: "Unavailable" }
      : { incomplete: "未开始", overdue: "逾期未完成", overdue_review: "逾期完成待审核", overdue_archived: "逾期完成已审核", review: "完成待审核", archived: "已审核", unavailable: "未读取" },
    reasons: en ? {
      missing: "No completed record yet", draft: "Draft saved", pending: "Submitted for review", approved: "Review approved",
      changes_requested: "Changes requested", done: "Completion recorded", skipped: "Recorded as skipped / not needed",
      follow_up: "Follow-up remains", recorded: "Class-group feedback recorded", after_class: "Complete after class",
      reflection_empty: "No reflection entered in the lesson plan", forbidden: "This account cannot read these records", failed: "Records could not be loaded",
      reflection_unreviewed: "No post-class approval recorded for this reflection", timing_missing: "Completion timing is unavailable; lateness cannot be determined",
      published: "Results published for every student in this lesson", unpublished: "Some learning results remain unpublished",
    } : {
      missing: "尚无完成记录", draft: "已保存草稿", pending: "已提交，等待审核", approved: "已审核通过",
      changes_requested: "待修改后重新提交", done: "已登记完成", skipped: "已登记跳过或无需办理",
      follow_up: "仍需后续跟进", recorded: "已记录班群反馈", after_class: "课后填写",
      reflection_empty: "教案中尚未填写课后反思", forbidden: "当前账号暂无此项读取权限", failed: "此项记录读取失败",
      reflection_unreviewed: "反思尚无课后审核记录", timing_missing: "完成时间缺失，暂不能判断是否逾期",
      published: "本课名单内学生的学情成果均已发布", unpublished: "本课仍有学情成果未发布",
    },
    sources: en ? {
      solution: "Solution submission and review", lesson_plan: "Lesson-plan submission and review", rehearsal_video: "Rehearsal-video submission and review",
      learning: "Learning-result coverage and publication for this lesson's roster", class_feedback: "Latest class-group record: lesson summary, tasks and whole-class feedback",
      homework: "Homework completion record", communication: "Completion record for individual follow-ups", reflection: "The post-class reflection section of the lesson plan, reviewed with the plan",
    } : {
      solution: "本课解析提交与审核", lesson_plan: "本课教案提交与审核", rehearsal_video: "本课练课视频提交与审核",
      learning: "本课名单内学生的学情成果发布与审核", class_feedback: "最近一条班群记录：课程总结、任务、整体学情与课评",
      homework: "本课作业任务完成记录", communication: "本课逐生沟通完成记录", reflection: "教案中的课后反思章节，随教案提交审核",
    },
    item: en ? "Item" : "项目", status: en ? "Progress" : "进度", record: en ? "Record" : "记录依据",
    due: en ? "Due" : "截止", completed: en ? "Completed" : "完成",
    unspecified: en ? "Other lessons" : "未编号课次", unscheduled: en ? "Unscheduled" : "待排时间", untitled: en ? "Untitled lesson" : "未命名课次",
    empty: en ? "No classes in this term" : "本学期暂无可见班级", noLessons: en ? "No lessons scheduled" : "尚未安排课次",
    noLinkedLessons: en ? "No linked lessons for this record" : "当前记录暂无关联课次",
    unset: en ? "Unset" : "待设置", unassigned: en ? "Unassigned" : "待安排老师", unknownGrade: en ? "Grade unset" : "年级待定",
    substitute: en ? "substitute" : "代课",
    open: en ? "View lesson details" : "查看课程详情", details: en ? "Materials and student records" : "课程材料与学生记录",
    close: en ? "Close lesson" : "收起课次", refresh: en ? "Refresh progress" : "刷新进度", search: en ? "Search class or teacher" : "搜索班级或老师",
    failed: en ? "Teaching progress could not be loaded. Refresh to retry." : "教学进度读取失败，请刷新重试。",
    partial: en ? "Some progress records are unavailable; expand a lesson for details." : "部分进度未读取，展开课次可查看原因。",
    lesson: (number: number) => en ? `Lesson ${number}` : `第 ${number} 讲`,
    gradeLabel: (grade: number) => en ? `Grade ${grade}` : `${grade} 年级`,
    allTeachers: en ? "All teachers" : "全部老师", filterEmpty: en ? "No classes match these filters" : "没有符合筛选条件的班级",
  };
}
