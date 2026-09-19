import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  preparationSubmitted, sessionNeedsAttention, summarizeTeachingByTeacher, summarizeTeachingSessions,
  taskCounts, teachingPeriodWindow, teachingWorkItems, type TeachingSession, type TeachingTask,
} from "../src/features/school/teaching-workbench/teaching-workbench-contract";
import { hasTeachingManagementScope } from "../src/features/school/teaching-workbench/teaching-workbench-access";
import { filterSchoolNav } from "../src/features/school/nav";
import type { WorkItemRow } from "../src/features/school/stage/types";

const now = new Date("2026-09-11T04:00:00Z");
const task = (overrides: Partial<TeachingTask> = {}): TeachingTask => ({
  id: "task", source: "postwork", kind: "summary", status: "pending", required: true,
  dueAt: null, assignedTo: "teacher", assigneeName: "Teacher", completedAt: null, ...overrides,
});
const session = (overrides: Partial<TeachingSession> = {}): TeachingSession => ({
  id: "session", classroomId: "class", classroomName: "Class", title: "Lesson",
  scheduledAt: "2026-09-13T04:00:00Z", startedAt: null, endedAt: null,
  preparationStatus: "not_started", preparedAt: null, autoFrozen: false,
  postworkCompletedAt: null, canOpenPreparation: true, teachers: [{ id: "teacher", name: "Teacher" }],
  artifacts: { solution: { status: "pending", submittedAt: now.toISOString() },
    lesson_plan: { status: "approved", submittedAt: now.toISOString() },
    rehearsal_video: { status: "pending", submittedAt: now.toISOString() } },
  tasks: [], ...overrides,
});

describe("teaching progress", () => {
  it("counts a full submission separately from approval, even before marking ready", () => {
    const row = session();
    expect(preparationSubmitted(row)).toBe(true);
    expect(summarizeTeachingSessions([row], now)).toMatchObject({ submitted: 1, approved: 0, overdue: 0 });
    row.artifacts.lesson_plan.status = "draft";
    expect(preparationSubmitted(row)).toBe(false);
    expect(sessionNeedsAttention(row, "preparation", now)).toBe(true);
    expect(sessionNeedsAttention(row, "overdue", now)).toBe(true);
  });

  it("does not infer submission from ready or automatic freezing", () => {
    const row = session({ preparationStatus: "ready", autoFrozen: true, startedAt: now.toISOString() });
    row.artifacts.solution.status = "missing";
    expect(summarizeTeachingSessions([row], now)).toMatchObject({ submitted: 0, approved: 0, overdue: 1 });
  });

  it("keeps skipped, absent and completed work distinct", () => {
    const tasks = [task({ status: "done" }), task({ status: "skipped" }), task()];
    expect(taskCounts(tasks)).toEqual({ total: 3, done: 1, skipped: 1, pending: 1 });
    expect(taskCounts([])).toEqual({ total: 0, done: 0, skipped: 0, pending: 0 });
    expect(summarizeTeachingSessions([session({ endedAt: now.toISOString() })], now)).toMatchObject({ ended: 1, postwork: 0 });
  });

  it("classifies contact work by its real task source, and ignores completed overdue deadlines", () => {
    const row = session({ endedAt: now.toISOString(), postworkCompletedAt: now.toISOString(), tasks: [
      task({ source: "support", kind: "postclass_followup", dueAt: "2026-09-10T00:00:00Z", status: "done" }),
      task({ kind: "followup", status: "skipped" }),
      task({ kind: "attendance", status: "done" }),
    ] });
    expect(sessionNeedsAttention(row, "overdue", now)).toBe(false);
    expect(sessionNeedsAttention(row, "contact", now)).toBe(false);
    expect(summarizeTeachingSessions([row], now).contact).toEqual({ total: 2, done: 1, skipped: 1, pending: 0 });
    row.tasks[0].status = "pending";
    expect(sessionNeedsAttention(row, "overdue", now)).toBe(true);
    expect(sessionNeedsAttention(row, "contact", now)).toBe(true);
  });

  it("groups by stable teacher ID and preserves unassigned sessions", () => {
    const rows = [session(), session({ id: "second", teachers: [{ id: "other", name: "Teacher" }] }), session({ id: "third", teachers: [] })];
    expect(summarizeTeachingByTeacher(rows, now).map(row => [row.id, row.summary.sessions])).toEqual([
      ["unassigned", 1], ["teacher", 1], ["other", 1],
    ]);
  });

  it("keeps date windows in the organization timezone, including year and DST boundaries", () => {
    expect(teachingPeriodWindow("week", "2026-09-13", "Asia/Shanghai", now)).toMatchObject({
      start: "2026-09-06T16:00:00.000Z", end: "2026-09-13T16:00:00.000Z", date: "2026-09-07", next: "2026-09-14",
    });
    expect(teachingPeriodWindow("month", "2026-12-20", "Asia/Shanghai", now)).toMatchObject({ previous: "2026-11-01", next: "2027-01-01" });
    const dst = teachingPeriodWindow("week", "2026-03-08", "America/New_York", now);
    expect((Date.parse(dst.end) - Date.parse(dst.start)) / 3_600_000).toBe(167);
    expect(teachingPeriodWindow("week", "2026-02-31", "Asia/Shanghai", now)).toEqual(teachingPeriodWindow("week", undefined, "Asia/Shanghai", now));
  });

  it("moves teaching and class support tasks without swallowing other departments", () => {
    const items = [
      { domain: "teaching", kind: "session.prepare" }, { domain: "teaching", kind: "session.overdue_not_started" },
      { domain: "student_service", kind: "support.task" }, { domain: "student_service", kind: "student.followup" },
      { domain: "curriculum", kind: "review.approve" },
    ] as WorkItemRow[];
    expect(teachingWorkItems(items)).toEqual(items.slice(0, 3));
  });

  it("keeps team access tied to the existing class visibility permission", () => {
    expect(hasTeachingManagementScope(new Set(["class.view.mine"]))).toBe(false);
    expect(hasTeachingManagementScope(new Set(["staff.invite"]))).toBe(false);
    expect(hasTeachingManagementScope(new Set(["class.view.all"]))).toBe(true);
    expect(filterSchoolNav(new Set(["class.view.mine"])).some(row => row.href === "/dashboard/classes")).toBe(true);
    expect(filterSchoolNav(new Set(["followup.view"])).some(row => row.href === "/dashboard/classes")).toBe(false);
  });

  it("counts only notifications in the bell and keeps a durable task destination", () => {
    const bell = fs.readFileSync("src/features/events/ChangeBell.tsx", "utf8");
    const header = fs.readFileSync("src/components/site-header.tsx", "utf8");
    expect(bell).not.toMatch(/totalWorkItems|workItems|TabsTrigger/);
    expect(header).not.toContain("listMyWorkItems");
    expect(bell).toContain("{unread > 0 && (");
    expect(bell).toContain('href="/dashboard?view=work"');
    const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
    const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));
    expect(Object.keys(zh.school.teachingWorkbench).sort()).toEqual(Object.keys(en.school.teachingWorkbench).sort());
    expect(zh.changes.label).not.toContain("{tasks}");
    expect(en.changes.label).not.toContain("{tasks}");
  });
});
