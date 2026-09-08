import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/zh.json";
import type { CourseEnrollmentRow, EnrollmentPlacementBoard, PlacementClassroom, PlacementMember } from "@/features/school/enrollment-workflow-contract";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
const IntlProvider=NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>,'children'>>>;

// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportEntry", () => ({ SchoolSupportAddButton: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
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
    terms: ["autumn", "spring", "previous-autumn"].map((id) => ({ id, name: id === "previous-autumn" ? "2025–2026 学年 · 秋季" : `2026–2027 学年 · ${id === "autumn" ? "秋季" : "春季"}`, isCurrent: id === "autumn", startsOn: null, endsOn: null })),
    classrooms: [
      classroom("autumn-4-empty"),
      classroom("spring-4", "math-4", "spring", { activeCount: 1 }),
      classroom("autumn-5", "math-5", "autumn", { activeCount: 1 }),
      classroom("autumn-4", "math-4", "autumn", { activeCount: 2 }),
      classroom("autumn-6-empty", "math-6"),
      classroom("previous-autumn-4", "math-4", "previous-autumn", { activeCount: 1 }),
    ],
  },
  members: [
    member("assigned-fourth", "autumn-4", 1),
    member("paused-fourth", "autumn-4", 2, "paused"),
    member("withdrawn-fourth", "autumn-4", 3, "withdrawn"),
    member("assigned-fifth", "autumn-5", 1),
    member("assigned-spring", "spring-4", 1),
    member("assigned-previous-autumn", "previous-autumn-4", 1),
  ],
  enrollments: [enrollment("pending-fourth"), enrollment("pending-fifth", "math-5"), enrollment("pending-spring", "math-4", "spring"), enrollment("withdrawn-pending", "math-4", "autumn", "cancelled")],
};

function renderRoster(initialTermId?: string, props: Partial<ComponentProps<typeof EnrollmentPlacementWorkbench>> = {}) {
  const markup = renderToStaticMarkup(createElement(IntlProvider, {
    locale: "zh", timeZone: "Asia/Shanghai", now: new Date("2026-09-05T00:00:00Z"), messages,
  },createElement(EnrollmentPlacementWorkbench, { initialBoard: board, initialTermId, canCreateClass: false, ...props })));
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
  it("includes all periods and source arrangements when no current period is configured", () => {
    const initialBoard = { ...board, options: { ...board.options, terms: board.options.terms.map(term => ({ ...term, isCurrent: false })) } };
    const history: NonNullable<ComponentProps<typeof EnrollmentPlacementWorkbench>['history']> = {
      renewals: [], activities: [], assessments: [], communications: [], sources: {},
      students: { 'existing-student': '历史学生' }, subjects: { 'existing-student': { name: '历史学生', phone: '', grade: 4 } },
      enrollments: [{ id: 'historical-enrollment', course_enrollment_id: 'historical-enrollment', student_id: 'existing-student',
        source_record_id: 'existing-source', source_field_ids: ['enrollment'], registered_on: '2025-01-02', period_label: '往期寒假',
        amount: 1200, amount_original: '1200', class_label: '原寒假班', teacher_label: '原老师', room_label: '原教室', schedule_label: '周六上午' }],
    };
    const rows = renderRoster(undefined, { initialBoard, history, initialRecordState: 'all' });
    expect(rows.flatMap(row => classroomId(row.attributes) ? [classroomId(row.attributes)] : []).sort())
      .toEqual(board.options.classrooms.map(value => value.id).sort());
    const current = rows.find(row => classroomId(row.attributes) === 'autumn-4')!;
    const historical = rows.find(row => row.attributes.includes('data-record-state="historical"'))!;
    const columnClasses = (row: typeof historical) => row.cells.map(cell => cell.attributes.match(/class="([^"]*)"/)?.[1]);
    expect(columnClasses(historical)).toEqual(columnClasses(current));
    expect(studentKeys(historical.cells[3].content)).toEqual(['historical-enrollment']);
    expect(historical.content).toContain('原老师');
    expect(historical.content).toContain('1200');
    expect(historical.content).not.toMatch(/data-placement-target|data-placement-select|touch-none/);
    for(const initialRecordState of ['current','historical'] as const){
      const visible=renderRoster(undefined,{initialBoard,history,initialRecordState});
      expect(visible.some(row=>row.attributes.includes('data-record-state="historical"'))).toBe(initialRecordState==='historical');
      expect(visible.some(row=>classroomId(row.attributes))).toBe(initialRecordState==='current');
    }
    const mixed = { ...history, enrollments: [...history.enrollments, { ...history.enrollments[0], id: 'active-source', record_state: 'current' as const }] };
    const visible = renderRoster(undefined, { initialBoard, history: mixed });
    const keys = visible.flatMap(row => studentKeys(row.content));
    expect(keys).toContain('active-source');
    expect(keys).not.toContain('historical-enrollment');
    expect(visible.find(row => studentKeys(row.content).includes('active-source'))?.attributes).toContain('data-record-state="current"');
  });

  it("defaults to the current school-year period and keeps each class and its students together", () => {
    const rows = renderRoster();
    const classes = rows.filter((row) => classroomId(row.attributes));
    expect(classes.map((row) => classroomId(row.attributes)).sort()).toEqual(board.options.classrooms.filter((value) => value.termId === "autumn").map((value) => value.id).sort());
    for (const key of ["assigned-spring", "pending-spring", "assigned-previous-autumn"]) {
      expect(rows.flatMap(row => studentKeys(row.content))).not.toContain(key);
    }
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
      .toEqual(["autumn:4", "autumn:5", "autumn:6"]);
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

  it.each(["autumn", "spring", "previous-autumn"])("an explicit %s term keeps other terms out of all roster rows", (termId) => {
    const rows = renderRoster(termId);
    expect(rows.flatMap((row) => classroomId(row.attributes) ? [classroomId(row.attributes)] : []).sort())
      .toEqual(board.options.classrooms.filter((value) => value.termId === termId).map((value) => value.id).sort());
    const expected = termId === "autumn"
      ? ["assigned-fourth", "paused-fourth", "withdrawn-fourth", "assigned-fifth", "pending-fourth", "pending-fifth", "withdrawn-pending"]
      : termId === "spring" ? ["assigned-spring", "pending-spring"] : ["assigned-previous-autumn"];
    expect(rows.flatMap((row) => studentKeys(row.content)).sort()).toEqual(expected.sort());
    expect(rows.filter((row) => row.attributes.includes("data-placement-pending")).every((row) => row.attributes.includes(`data-placement-pending="${termId}:`))).toBe(true);
  });
});
