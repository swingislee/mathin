import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { groupTeachingClasses, type TeachingClassOverview, type TeachingSessionMetrics } from "../src/features/school/teaching-workbench/teaching-class-overview-contract";
import { TeachingClassOverviewTable } from "../src/features/school/teaching-workbench/TeachingClassOverviewTable";
import type { TeachingSession } from "../src/features/school/teaching-workbench/teaching-workbench-contract";

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
const at = "2026-09-15T01:00:00Z";
const session = (id: string, teacher = "teacher"): TeachingSession => ({
  id, classroomId: "class", classroomName: "这是一个用于验证固定列宽的完整班级名称", title: `课次${id}`, scheduledAt: at,
  startedAt: null, endedAt: null, postworkCompletedAt: null, preparationStatus: "not_started", preparedAt: null,
  autoFrozen: false, canOpenPreparation: false, teachers: [{ id: teacher, name: teacher }], tasks: [],
  artifacts: { solution: { status: "missing", submittedAt: null }, lesson_plan: { status: "missing", submittedAt: null }, rehearsal_video: { status: "missing", submittedAt: null } },
});
const metric = (id: string, overrides: Partial<TeachingSessionMetrics> = {}): TeachingSessionMetrics => ({
  sessionId: id, studentIds: ["one", "two"], attendance: { marked: 1, present: 1, late: 1, absent: 0, leave: 0 },
  checkCount: 2, ratedCount: 2, attentionStudents: [{ id: "one", name: "学生甲" }], reviewCount: 1,
  latestReview: { content: "能说明思路", studentName: "学生甲", author: "老师", at }, ...overrides,
});
const data: TeachingClassOverview = {
  workbench: { sessions: [session("first"), session("second", "substitute")], truncated: false },
  metrics: [metric("first"), metric("second")], canReadContacts: true,
  classContacts: [{ classroomId: "class", count: 3, studentCount: 1, latest: { content: "愿意继续练习", studentName: "学生甲", author: "沟通老师", at } }],
};

describe("class teaching overview", () => {
  it("groups by class, deduplicates people and preserves student-lesson denominators", () => {
    const groups = groupTeachingClasses(data);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ studentCount: 2, rosterEntries: 4, recordedSessions: 2, endedSessions: 0,
      ratedCount: 4, expectedRatings: 8, reviewCount: 2, contacts: { count: 3, studentCount: 1 }, attendance: { marked: 2, present: 2, late: 2, absent: 0 } });
    expect(groups[0].attention).toEqual([{ id: "one", name: "学生甲" }]);
  });
  it("filters teacher sessions before computing class totals", () => {
    expect(groupTeachingClasses(data, "substitute")[0]).toMatchObject({ recordedSessions: 1, rosterEntries: 2, expectedRatings: 4 });
    expect(groupTeachingClasses(data, "missing")).toEqual([]);
    expect(groupTeachingClasses(data, undefined, "missing")).toEqual([]);
  });
  it("does not infer absence, attention or a completed lesson from missing recordings", () => {
    const empty = metric("first", { attendance: { marked: 0, present: 0, absent: 0, late: 0, leave: 0 }, ratedCount: 0, attentionStudents: [], reviewCount: 0, latestReview: null });
    const group = groupTeachingClasses({ ...data, workbench: { ...data.workbench, sessions: [session("first")] }, metrics: [empty] })[0];
    expect(group).toMatchObject({ recordedSessions: 0, endedSessions: 0, ratedCount: 0, attention: [], attendance: { absent: 0 } });
    expect(() => groupTeachingClasses({ ...data, metrics: [] })).toThrow("TEACHING_SESSION_METRICS_MISSING");
  });
  it("shows attendance, learning and actual feedback in the collapsed class row", () => {
    const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;
    const html = renderToStaticMarkup(createElement(Provider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, createElement(TeachingClassOverviewTable, {
      data, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching?view=records",
    })));
    for (const text of ["已记 2/2", "到课 2/2", "学情 4/8", "学生甲", "能说明思路", "愿意继续练习", "3 条 · 1 人"]) expect(html).toContain(text);
    expect(html).not.toContain("课次first");
    expect(html).not.toContain("课次second");
    expect(html).toContain("table-fixed");
  });
});
