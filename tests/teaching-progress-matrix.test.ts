import { describe, expect, it } from "vitest";
import { createLessonPlanTemplateV1 } from "../src/features/school/teacher-preparation-contract";
import { classWorkHref } from "../src/features/school/work-entry-contract";
import {
  TEACHING_PROGRESS_ITEMS, artifactProgress, classFeedbackProgress, completionProgress, hasLessonReflection, learningProgress,
  reflectionProgress, teachingMatrixColumns, teachingMatrixMessages, teachingMatrixSessions, teachingMatrixTeachers, type TeachingProgressSession,
} from "../src/features/school/teaching-workbench/teaching-progress-matrix-contract";

const session = (overrides: Partial<TeachingProgressSession> = {}): TeachingProgressSession => ({
  id: "s1", classroomId: "class1", title: "Lesson", lectureNo: 1, scheduledAt: "2026-10-01T00:00:00Z",
  duration: 60, startedAt: null, endedAt: null, teacherOverride: null,
  progress: Object.fromEntries(TEACHING_PROGRESS_ITEMS.map(key => [key, artifactProgress()])) as TeachingProgressSession["progress"],
  ...overrides,
});

describe("teaching matrix projection", () => {
  it("archives learning only when every roster student has a published result", () => {
    for (const statuses of [[], ["missing"], ["published", "missing"], ["published", "draft"], ["withdrawn"], ["revised"]]) expect(learningProgress(statuses).state).toBe("incomplete");
    expect(learningProgress(["review", "published"]).state).toBe("review");
    expect(learningProgress(["published", "published"]).state).toBe("archived");
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

  it("does not count skipped or missing tasks and unresolved class feedback as archived", () => {
    expect(completionProgress("done").state).toBe("archived");
    expect(completionProgress("skipped")).toEqual({ state: "incomplete", reason: "skipped" });
    expect(classFeedbackProgress("contacted").state).toBe("archived");
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
