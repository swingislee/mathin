import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import { teachingContactPage, teachingRecordHref, teachingRecordsSchema, type TeachingRecords } from "../src/features/school/teaching-workbench/teaching-records-contract";
import { TeachingSessionRecords } from "../src/features/school/teaching-workbench/TeachingSessionRecords";
import { TeachingProgressTable } from "../src/features/school/teaching-workbench/TeachingProgressTable";
import type { TeachingSession } from "../src/features/school/teaching-workbench/teaching-workbench-contract";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ replace: vi.fn() }),
}));
const at = "2026-09-15T01:00:00Z";
const records: TeachingRecords = {
  session: { id: "session", classroomId: "class", classroomName: "示例班", title: "第一讲", scheduledAt: at, startedAt: null, endedAt: null },
  students: [{ id: "one", name: "学生甲" }, { id: "two", name: "学生乙" }],
  attendance: [{ studentId: "one", status: "late", note: "保存的考勤备注" }],
  checks: [{ id: "check", title: "分数题" }],
  results: [{ checkId: "check", studentId: "one", status: "prompted", markedAt: at, author: "任课老师" }],
  reviews: [{ studentId: "one", comment: "能够说明思路，还需巩固", entryScore: 0, exitScore: null, focus: 3, participation: null, mastery: null, updatedAt: at, author: "任课老师" }],
  canReadContacts: true, contacts: [{ id: "contact", studentId: "one", content: "家长反馈愿意继续练习", kind: "class", createdAt: at, occurredOn: null, author: "跟进老师" }],
  contactTotal: 1, contactPage: 1, supportNotes: [],
};
const IntlProvider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;
function render(node: import("react").ReactNode) {
  return renderToStaticMarkup(createElement(IntlProvider, { locale: "zh", messages, timeZone: "Asia/Shanghai" }, node));
}

describe("teaching actual records", () => {
  it("renders saved observations, missing records, authors and full feedback before system start", async () => {
    const html = render(createElement(TeachingSessionRecords, { data: records, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching?view=records", currentHref: "/dashboard/teaching?view=records&session=session" }));
    for (const text of ["未在系统开课", "分数题", "保存的考勤备注", "能够说明思路，还需巩固", "尚未保存课评", "家长反馈愿意继续练习", "任课老师", "跟进老师", "可能涉及其他课次"]) expect(html).toContain(text);
    expect(html).toContain("入口分数：");
    expect(html).toContain('tabular-nums">0</dd>');
  });
  it("shows an explicit restricted contact state", async () => {
    const html = render(createElement(TeachingSessionRecords, { data: { ...records, canReadContacts: false, contacts: [], contactTotal: 0 }, locale: "zh", timeZone: "Asia/Shanghai", returnTo: "/dashboard/teaching", currentHref: "/dashboard/teaching?session=session" }));
    expect(html).toContain("查看沟通正文需要沟通查看权限");
    expect(html).not.toContain("家长反馈愿意继续练习");
    expect(html).toContain("能够说明思路，还需巩固");
  });
  it("keeps teacher, class and period when entering a record and resets contact pagination", () => {
    const url = new URL(teachingRecordHref("/dashboard/teaching?view=progress&period=month&date=2026-09-01&contactPage=5", "lesson", "teacher", "class"), "http://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "records", period: "month", date: "2026-09-01", session: "lesson", teacher: "teacher", classroom: "class" });
    expect(teachingRecordHref("/dashboard/teaching?teacher=old&classroom=old", "lesson")).not.toContain("old");
  });
  it("pages within a database block and clamps the last short page", () => {
    const contacts = Array.from({ length: 20 }, (_, index) => ({ ...records.contacts[0], id: String(index) }));
    expect(teachingContactPage({ ...records, contacts, contactTotal: 21 }, 2, 10).contacts.map(row => row.id)).toEqual(contacts.slice(10).map(row => row.id));
    const last = teachingContactPage({ ...records, contacts: [{ ...records.contacts[0], id: "20" }], contactTotal: 21, contactPage: 2 }, 99, 10);
    expect(last.contactPage).toBe(3);
    expect(last.contacts.map(row => row.id)).toEqual(["20"]);
    expect(teachingRecordsSchema.safeParse({ ...records, results: [{ ...records.results[0], status: "unknown" }] }).success).toBe(false);
  });
  it("provides a records list without preparation overdue judgments for learning-only usage", () => {
    const session: TeachingSession = {
      ...records.session, scheduledAt: at, teachers: [{ id: "teacher", name: "任课老师" }],
      postworkCompletedAt: null, preparationStatus: "not_started", preparedAt: null, autoFrozen: false, canOpenPreparation: false,
      artifacts: { solution: { status: "missing", submittedAt: null }, lesson_plan: { status: "missing", submittedAt: null }, rehearsal_video: { status: "missing", submittedAt: null } }, tasks: [],
    };
    const html = render(createElement(TeachingProgressTable, { data: { sessions: [session], truncated: false }, locale: "zh", timeZone: "Asia/Shanghai", now: at, returnTo: "/dashboard/teaching?view=records", mode: "records" }));
    expect(html).toContain("查看实际记录");
    expect(html).toContain("任课老师");
    expect(html).toContain("未在系统开课");
    expect(html).not.toContain(messages.school.teachingWorkbench.preparationOverdue);
    expect(html).not.toContain(messages.school.teachingWorkbench.materialsSubmitted);
  });
});
