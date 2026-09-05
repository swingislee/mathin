import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import type { CourseEnrollmentRow, EnrollmentPlacementBoard, PlacementClassroom, PlacementMember } from "@/features/school/enrollment-workflow-contract";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";

vi.mock("@/features/school/enrollment-workflow-actions", () => ({ moveEnrollmentSeatAction: vi.fn() }));
vi.mock("@/features/school/Student360Sheet", () => ({
  Student360Trigger: ({ children, className }: { children: ReactNode; className?: string }) => createElement("button", { type: "button", className }, children),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard/followups/enrollments",
}));

const classroom = (id: string, courseId = "math-4", termId = "autumn", overrides: Partial<PlacementClassroom> = {}): PlacementClassroom => ({
  id, name: id, courseId, termId, capacity: 3, activeCount: 0, operationalStatus: "active", teacherNames: "测试教师", sessions: [], ...overrides,
});
const member = (id: string, classroomId: string, seat: number, status: PlacementMember["status"] = "active"): PlacementMember => ({
  membershipId: id, studentId: `student-${id}`, name: id, phone: "", classroomId, enrollmentId: null, note: "", recommendation: "", seat, status,
});
const enrollment = (id: string, courseId = "math-4", termId = "autumn", status: CourseEnrollmentRow["status"] = "active"): CourseEnrollmentRow => ({
  id, opportunityId: `opportunity-${id}`, studentId: `student-${id}`, studentName: id, studentPhone: "", courseId, courseTitle: courseId, termId, termName: termId,
  status, note: "", confirmedAt: "2026-09-01T00:00:00Z", confirmedByName: "", cancelledAt: null, cancelledByName: null,
  assignmentId: null, classroomId: null, classroomName: null, membershipId: null, assignedAt: null, claimableClassroomIds: [], updatedAt: "2026-09-01T00:00:00Z",
});

const board: EnrollmentPlacementBoard = {
  options: {
    courses: [4, 5, 6].map((grade) => ({ id: `math-${grade}`, title: `${grade}年级数学`, productCode: null, grade, classType: "standard" })),
    terms: ["autumn", "spring"].map((id) => ({ id, name: id, isCurrent: id === "autumn", startsOn: null, endsOn: null })),
    classrooms: [
      classroom("autumn-4-empty"),
      classroom("spring-4", "math-4", "spring", { activeCount: 1 }),
      classroom("autumn-5", "math-5", "autumn", { activeCount: 1 }),
      classroom("autumn-4", "math-4", "autumn", { activeCount: 2 }),
      classroom("autumn-6-empty", "math-6"),
    ],
  },
  members: [
    member("assigned-fourth", "autumn-4", 1),
    member("paused-fourth", "autumn-4", 2, "paused"),
    member("withdrawn-fourth", "autumn-4", 3, "withdrawn"),
    member("assigned-fifth", "autumn-5", 1),
    member("assigned-spring", "spring-4", 1),
  ],
  enrollments: [enrollment("pending-fourth"), enrollment("pending-fifth", "math-5"), enrollment("pending-spring", "math-4", "spring"), enrollment("withdrawn-pending", "math-4", "autumn", "cancelled")],
};

function renderRoster(initialTermId?: string) {
  const markup = renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale: "zh", timeZone: "Asia/Shanghai", now: new Date("2026-09-05T00:00:00Z"), messages,
    children: createElement(EnrollmentPlacementWorkbench, { initialBoard: board, initialTermId, canCreateClass: false }),
  }));
  const body = markup.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  expect(body, "the workbench renders its class roster as a table body").toBeDefined();
  return [...body!.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)].map((match) => ({
    attributes: match[1],
    content: match[2],
    cells: [...match[2].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((cell) => ({ attributes: cell[1], content: cell[2] })),
  }));
}

const studentKeys = (content: string) => [...content.matchAll(/data-placement-student="([^"]+)"/g)].map((match) => match[1]);
const classroomId = (attributes: string) => attributes.match(/data-placement-classroom="([^"]+)"/)?.[1];

describe("enrollment placement class roster", () => {
  it("renders each class once and keeps its students together in the roster cell", () => {
    const rows = renderRoster();
    const classes = rows.filter((row) => classroomId(row.attributes));
    expect(classes.map((row) => classroomId(row.attributes)).sort()).toEqual(board.options.classrooms.map((value) => value.id).sort());
    const fourth = classes.find((row) => classroomId(row.attributes) === "autumn-4")!;
    expect(fourth.cells).toHaveLength(4);
    expect(studentKeys(fourth.cells.slice(0, 3).map((cell) => cell.content).join(""))).toEqual([]);
    expect(studentKeys(fourth.cells[3].content)).toEqual(["assigned-fourth", "paused-fourth"]);
    expect(rows.filter((row) => studentKeys(row.content).includes("assigned-fourth"))).toHaveLength(1);
  });

  it("starts every term and grade group with pending placement, including an empty grade", () => {
    const rows = renderRoster();
    const groupHeaders = rows.flatMap((row, index) => row.cells.length === 1 && row.cells[0].attributes.includes('colSpan="4"') ? [index] : []);
    expect(groupHeaders.map((index) => rows[index + 1].attributes.match(/data-placement-pending="([^"]+)"/)?.[1]))
      .toEqual(["autumn:4", "autumn:5", "autumn:6", "spring:4"]);
    const pendingFourth = rows.find((row) => row.attributes.includes('data-placement-pending="autumn:4"'))!;
    expect(studentKeys(pendingFourth.cells[1].content)).toEqual(["pending-fourth"]);
    const emptyGrade = rows.find((row) => row.attributes.includes('data-placement-pending="autumn:6"'))!;
    expect(emptyGrade.content).toContain(messages.school.enrollmentWorkflow.noPending);
  });

  it("keeps empty classes visible with their available seats", () => {
    const rows = renderRoster();
    for (const id of ["autumn-4-empty", "autumn-6-empty"]) {
      const emptyClass = rows.find((row) => classroomId(row.attributes) === id)!;
      expect(emptyClass).toBeDefined();
      expect(studentKeys(emptyClass.cells[3].content)).toEqual([]);
      expect([...emptyClass.cells[3].content.matchAll(/aria-label="第(\d+)位空位"/g)].map((match) => Number(match[1]))).toEqual([1, 2, 3]);
    }
  });

  it("keeps paused students in their seats and withdrawals in separate rows", () => {
    const rows = renderRoster();
    const classIndex = rows.findIndex((row) => classroomId(row.attributes) === "autumn-4");
    const seated = rows[classIndex].cells[3].content;
    expect(seated).toMatch(/data-placement-target="autumn-4:2"[^>]*><span\b[^>]*data-placement-student="paused-fourth"/);
    expect(seated).toContain(messages.school.enrollmentWorkflow.status_paused);
    expect(seated).not.toContain('data-placement-student="withdrawn-fourth"');
    expect(studentKeys(rows[classIndex + 1].content)).toEqual(["withdrawn-fourth"]);
    expect(rows[classIndex + 1].cells[0].content).toContain(messages.school.enrollmentWorkflow.status_withdrawn);
    const withdrawnPending = rows.find((row) => studentKeys(row.content).includes("withdrawn-pending"))!;
    expect(withdrawnPending.attributes).not.toContain("data-placement-pending");
    expect(withdrawnPending.cells[0].content).toContain(messages.school.enrollmentWorkflow.status_withdrawn);
  });

  it.each(["autumn", "spring"])("an explicit %s term keeps other terms out of all roster rows", (termId) => {
    const rows = renderRoster(termId);
    expect(rows.flatMap((row) => classroomId(row.attributes) ? [classroomId(row.attributes)] : []).sort())
      .toEqual(board.options.classrooms.filter((value) => value.termId === termId).map((value) => value.id).sort());
    const expected = termId === "autumn"
      ? ["assigned-fourth", "paused-fourth", "withdrawn-fourth", "assigned-fifth", "pending-fourth", "pending-fifth", "withdrawn-pending"]
      : ["assigned-spring", "pending-spring"];
    expect(rows.flatMap((row) => studentKeys(row.content)).sort()).toEqual(expected.sort());
    expect(rows.filter((row) => row.attributes.includes("data-placement-pending")).every((row) => row.attributes.includes(`data-placement-pending="${termId}:`))).toBe(true);
  });
});
