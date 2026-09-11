import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import {
  applyLearningResultUpdates,
  classroomLearningReminder,
  type ClassroomLearningReminder,
} from "@/features/school/classroom-learning-reminder";
import { SessionLearningReminderButton } from "@/features/school/SessionLearningReminderButton";
import { learningCheckIdAfterPageChange, learningResultKey, type LearningCheckStatus } from "@/features/school/session-learning-contract";

const translations = vi.hoisted(() => ({ locale: "zh" as "zh" | "en" }));
vi.mock("next-intl", async () => {
  const { createTranslator } = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    useTranslations: () => createTranslator({
      locale: translations.locale, messages: translations.locale === "zh" ? zh : en,
      namespace: "school.session", onError: error => { throw error; },
    }),
  };
});

const checks = [
  { id: "check-a", position: 0, title: "Same title", sourcePageId: "page-a" },
  { id: "check-b", position: 1, title: "Same title", sourcePageId: "page-b" },
  { id: "manual", position: 2, title: "Manual observation", sourcePageId: null },
];
const students = Array.from({ length: 3 }, (_, index) => ({ id: `student-${index}`, name: `Student ${index}`, seatPosition: index }));
const cell = (index: number, checkId = "check-a") => ({ checkId, studentId: students[index].id });
const key = (index: number, checkId = "check-a") => learningResultKey(checkId, students[index].id);
const empty = new Set<string>();
const input = {
  checks, students, activePageDocId: "page-a", savedResults: new Map<string, LearningCheckStatus>(),
  savingCellKeys: empty, excludedStudentIds: empty, attendanceSavingStudentIds: empty,
};

describe("page-bound classroom learning reminders", () => {
  it("does not light an ordinary, media or board page when the panel retains its previous check", () => {
    expect(learningCheckIdAfterPageChange(checks, "check-a", "ordinary-page")).toBe("check-a");
    expect(classroomLearningReminder({ ...input, activePageDocId: "ordinary-page" })).toBeNull();
    expect(classroomLearningReminder({ ...input, activePageDocId: null })).toBeNull();
    expect(classroomLearningReminder({ ...input, checks: [checks[2]] })).toBeNull();
  });

  it("uses stable page identity and counts only that page's current roster", () => {
    const savedResults = new Map<string, LearningCheckStatus>([
      [key(0), "independent"], [key(1, "check-b"), "explained"],
      [learningResultKey("check-a", "former-student"), "independent"],
    ]);
    expect(classroomLearningReminder({ ...input, savedResults })).toEqual({
      checkId: "check-a", recorded: 1, total: 3, state: "partial",
    });
    expect(classroomLearningReminder({ ...input, savedResults, activePageDocId: "page-b" })?.recorded).toBe(1);
  });

  it("keeps the reminder pending until results are committed, then shows partial and completed registration", () => {
    const optimistic = applyLearningResultUpdates(input.savedResults, [cell(0), cell(1), cell(2)], "independent");
    expect(input.savedResults.size).toBe(0);
    expect(optimistic.size).toBe(3);
    expect(classroomLearningReminder({ ...input, savingCellKeys: new Set([key(0), key(1), key(2)]) })).toMatchObject({
      recorded: 0, total: 3, state: "saving",
    });
    // 失败时沿用原来的已保存记录；成功后才将相应结果交给提醒。
    expect(classroomLearningReminder(input)?.state).toBe("pending");
    const partial = applyLearningResultUpdates(input.savedResults, [cell(0)], "independent");
    expect(classroomLearningReminder({ ...input, savedResults: partial })?.state).toBe("partial");
    expect(classroomLearningReminder({ ...input, savedResults: optimistic })).toMatchObject({ recorded: 3, state: "complete" });
  });

  it("counts all recorded learning statuses, including incomplete work, and reopens after an undo", () => {
    const savedResults = new Map<string, LearningCheckStatus>([
      [key(0), "explained"], [key(1), "prompted"], [key(2), "incomplete"],
    ]);
    expect(classroomLearningReminder({ ...input, savedResults })?.state).toBe("complete");
    const undone = applyLearningResultUpdates(savedResults, [cell(2)], "unchecked");
    expect(classroomLearningReminder({ ...input, savedResults: undone })).toMatchObject({ recorded: 2, state: "partial" });
    expect(savedResults.get(key(2))).toBe("incomplete");
    expect(classroomLearningReminder({ ...input, savedResults, savingCellKeys: new Set([key(2)]) })?.state).toBe("saving");
  });

  it("aligns absent and leave exclusions with bulk entry while waiting for attendance to save", () => {
    const savedResults = applyLearningResultUpdates(input.savedResults, [cell(0)], "imitated");
    const excludedStudentIds = new Set([students[1].id, students[2].id]);
    expect(classroomLearningReminder({ ...input, savedResults, excludedStudentIds })).toMatchObject({
      recorded: 1, total: 1, state: "complete",
    });
    expect(classroomLearningReminder({ ...input, savedResults, excludedStudentIds,
      attendanceSavingStudentIds: new Set([students[2].id]) })?.state).toBe("saving");
    expect(classroomLearningReminder({ ...input, savedResults,
      excludedStudentIds: new Set([students[1].id]) })).toMatchObject({ total: 2, state: "partial" });
  });

  it("marks an empty eligible roster as empty and ignores saves for other questions", () => {
    expect(classroomLearningReminder({ ...input, students: [] })).toMatchObject({ total: 0, state: "empty" });
    expect(classroomLearningReminder({ ...input, excludedStudentIds: new Set(students.map(student => student.id)) })?.state).toBe("empty");
    expect(classroomLearningReminder({ ...input, savingCellKeys: new Set([key(0, "check-b")]) })?.state).toBe("pending");
  });
});

const renderButton = (reminder: ClassroomLearningReminder | null, locale: "zh" | "en" = "zh") => {
  translations.locale = locale;
  return renderToStaticMarkup(createElement(SessionLearningReminderButton, { reminder, rail: true }));
};

describe("learning reminder entry", () => {
  it.each(["zh", "en"] as const)("renders the current page action and progress in %s", locale => {
    const markup = renderButton({ checkId: "check-a", state: "partial", recorded: 12, total: 20 }, locale);
    expect(markup).toContain('data-classroom-learning-reminder="partial"');
    expect(markup).toContain('data-learning-reminder-recorded="12"');
    expect(markup).toContain('data-learning-reminder-total="20"');
    expect(markup).toContain(locale === "zh" ? "本页继续记录" : "Continue recording");
    expect(markup).toContain(locale === "zh" ? "已登记 12 / 20 人" : "12 / 20 recorded");
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toContain("MISSING_MESSAGE");
  });

  it("keeps ordinary pages circular and makes saved completion a distinct quiet state", () => {
    const ordinary = renderButton(null);
    expect(ordinary).not.toContain("data-classroom-learning-reminder=");
    expect(ordinary).toContain("size-11");
    expect(ordinary).toContain("登记学情");
    const complete = renderButton({ checkId: "check-a", state: "complete", recorded: 3, total: 3 });
    expect(complete).toContain("本页已记录");
    expect(complete).toContain("lucide-check");
    expect(complete).not.toContain("animate-spin");
    expect(complete).toContain("w-auto");
  });

  it("announces saving without exposing an optimistic completed count", () => {
    const markup = renderButton({ checkId: "check-a", state: "saving", recorded: 2, total: 3 });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("已登记 2 / 3 人");
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).not.toContain("本页已记录");
  });
});
