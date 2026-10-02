import { describe, expect, it } from "vitest";
import { createLessonPlanTemplateV1 } from "../src/features/school/teacher-preparation-contract";
import { classWorkHref } from "../src/features/school/work-entry-contract";
import {
  TEACHING_PROGRESS_ITEMS, TEACHING_PROGRESS_STATES, artifactProgress, classFeedbackProgress, completionProgress, hasLessonReflection, learningProgress, timedTeachingProgress,
  reflectionProgress, teachingMatrixColumns, teachingMatrixMessages, teachingMatrixSessions, teachingMatrixTeachers, type TeachingProgressSession,
} from "../src/features/school/teaching-workbench/teaching-progress-matrix-contract";

const session = (overrides: Partial<TeachingProgressSession> = {}): TeachingProgressSession => ({
  id: "s1", classroomId: "class1", title: "Lesson", lectureNo: 1, scheduledAt: "2026-10-01T00:00:00Z",
  duration: 60, startedAt: null, endedAt: null, teacherOverride: null,
  progress: Object.fromEntries(TEACHING_PROGRESS_ITEMS.map(key => [key, artifactProgress()])) as TeachingProgressSession["progress"],
  ...overrides,
});

describe("teaching matrix projection", () => {
  it("distinguishes all six stages using completion time instead of review waiting time", () => {
    const dueAt = "2026-10-01T00:00:00Z", now = Date.parse("2026-10-03T00:00:00Z");
    const before = "2026-09-30T23:59:59Z", after = "2026-10-01T00:00:01Z";
    const state = (status: string | undefined, completedAt: string | null, clock = now) => timedTeachingProgress(artifactProgress(status), { dueAt, completedAt, now: clock }).state;
    expect([
      state(undefined, null, Date.parse(dueAt)), state(undefined, null), state("pending", after),
      state("approved", after), state("pending", before), state("approved", before),
    ]).toEqual(TEACHING_PROGRESS_STATES);
    expect(state("pending", dueAt)).toBe("review");
    expect(state("approved", dueAt)).toBe("archived");
    expect(state("changes_requested", before)).toBe("overdue");
  });

  it("keeps missing timing and restricted data explicit, and does not invent a deadline", () => {
    const now = Date.parse("2026-10-03T00:00:00Z");
    expect(timedTeachingProgress(artifactProgress("approved"), { dueAt: "2026-10-01T00:00:00Z", now }).reason).toBe("timing_missing");
    expect(timedTeachingProgress(artifactProgress(), { dueAt: "invalid", now }).state).toBe("unavailable");
    expect(timedTeachingProgress(artifactProgress(), { now }).state).toBe("incomplete");
    expect(timedTeachingProgress(artifactProgress("approved"), { now }).state).toBe("archived");
    expect(timedTeachingProgress({ state: "unavailable", reason: "forbidden" }, { dueAt: "2026-10-01T00:00:00Z", now }).state).toBe("unavailable");
  });

  it("requires both complete published coverage and review evidence for approved learning", () => {
    for (const statuses of [[], ["missing"], ["published", "missing"], ["published", "draft"], ["withdrawn"], ["revised"]]) expect(learningProgress(statuses).state).toBe("incomplete");
    expect(learningProgress(["review", "published"]).state).toBe("review");
    expect(learningProgress(["published", "published"])).toEqual({ state: "review", reason: "published" });
    expect(learningProgress(["published", "published"], true).state).toBe("archived");
    expect(learningProgress([]).reason).toBe("missing");
    expect(learningProgress(["published", "missing"]).reason).toBe("missing");
    expect(learningProgress(["withdrawn"]).reason).toBe("unpublished");
  });
  it("preserves the explicit all-terms scope when linking to progress", () => {
    expect(classWorkHref("progress", { term: "all", teacher: "teacher-b" })).toContain("term=all");
    expect(classWorkHref("progress", { term: "all", teacher: "teacher-b" })).toContain("teacher=teacher-b");
  });

  it("labels substitutes even when no permanent assignment is visible", () => {
    const row = { id: "class1", name: "Class", termId: null, grade: 3, courseTitle: "Course", level: "A", campus: null, room: "", teachers: [] };
    const lesson = session({ teacherOverride: { id: "sub", name: "Substitute" } });
    expect(teachingMatrixTeachers(row, [lesson, lesson])).toEqual([{ id: "sub", name: "Substitute", substitute: true }]);
  });
  it("keeps the agreed eight items in reading order in both languages", () => {
    const zh = teachingMatrixMessages("zh"), en = teachingMatrixMessages("en");
    expect(TEACHING_PROGRESS_ITEMS.map(key => zh.items[key])).toEqual(["解析", "教案", "练课", "学情", "班群反馈", "作业", "沟通", "课后反思"]);
    expect(TEACHING_PROGRESS_ITEMS.every(key => Boolean(en.items[key]) && Boolean(en.sources[key]))).toBe(true);
  });

  it("distinguishes approved, submitted, draft and returned materials", () => {
    expect(artifactProgress("approved").state).toBe("archived");
    expect(artifactProgress("pending").state).toBe("review");
    expect(artifactProgress("draft")).toEqual({ state: "incomplete", reason: "draft" });
    expect(artifactProgress("changes_requested")).toEqual({ state: "incomplete", reason: "changes_requested" });
    expect(artifactProgress().state).toBe("incomplete");
  });

  it("keeps completion separate from approval and does not count skipped or unresolved records as completed", () => {
    expect(completionProgress("done").state).toBe("review");
    expect(completionProgress("skipped")).toEqual({ state: "incomplete", reason: "skipped" });
    expect(classFeedbackProgress("contacted").state).toBe("review");
    expect(classFeedbackProgress("follow_up")).toEqual({ state: "incomplete", reason: "follow_up" });
    expect(classFeedbackProgress("not_needed").state).toBe("incomplete");
  });

  it("does not mistake the saved template or other sections for a completed reflection", () => {
    const content = createLessonPlanTemplateV1();
    expect(hasLessonReflection(content)).toBe(false);
    content.splice(1, 0, { type: "paragraph", content: "课前已有的实质正文" });
    expect(hasLessonReflection(content)).toBe(false);
    content.push({ type: "heading", props: { level: 1 }, content: "五、补充材料" }, { type: "paragraph", content: "其它内容" });
    expect(hasLessonReflection(content)).toBe(false);
  });

  it("requires real reflection content, an ended lesson and the plan review state", () => {
    const content = createLessonPlanTemplateV1();
    content.push({ type: "paragraph", content: [{ type: "text", text: "下节课需要调整的地方：增加实物演示", styles: {} }] });
    expect(hasLessonReflection(content)).toBe(true);
    expect(reflectionProgress(null, { content, status: "approved" }).state).toBe("incomplete");
    expect(reflectionProgress("2026-10-01", { content, status: "draft" }).state).toBe("incomplete");
    expect(reflectionProgress("2026-10-01", { content, status: "pending" }).state).toBe("review");
    expect(reflectionProgress("2026-10-01", { content, status: "approved" }).state).toBe("archived");
  });

  it("aligns by the actual lecture number and retains repeat lessons and unnumbered sessions", () => {
    const rows = [session({ id: "repeat", scheduledAt: "2026-10-08" }), session(), session({ id: "other", classroomId: "class2", lectureNo: 4 }), session({ id: "free", lectureNo: null })];
    expect(teachingMatrixColumns(rows).map(column => column.lectureNo)).toEqual([1, 4, null]);
    expect(teachingMatrixSessions(rows, "class1", 1).map(row => row.id)).toEqual(["s1", "repeat"]);
    expect(teachingMatrixSessions(rows, "class2", 1)).toEqual([]);
    expect(teachingMatrixSessions(rows, "class1", null).map(row => row.id)).toEqual(["free"]);
  });
});
