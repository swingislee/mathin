// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { FollowupPrimaryFilter } from "@/features/school/FollowupPrimaryFilter";
import { FollowupCommandPanel } from "@/features/school/FollowupCommandPanel";
import { CommunicationWorkToolbar } from "@/features/school/CommunicationWorkToolbar";
import { CommunicationWorkSelectionProvider } from "@/features/school/CommunicationWorkSelection";
import { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";
import { assessmentWorkflowFromDb } from "@/features/school/assessment-workflow-contract";
import { EnrollmentPlacementWorkbench } from "@/features/school/EnrollmentPlacementWorkbench";
import type { EnrollmentPlacementBoard } from "@/features/school/enrollment-workflow-contract";
import { DashboardCommandState, DashboardCommandFilters, DashboardCommandActions } from "@/features/school/dashboard-page";

const actions = vi.hoisted(() => ({ replace: vi.fn(), create: vi.fn(), move: vi.fn(), query: "view=day&date=2026-09-07&scope=mine&q=Sample&page=4&pageSize=50&lead=focus&status=uncontacted" }));
// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportInlineEntry", () => ({ SchoolSupportTableEntry: ({ children }: { children: import("react").ReactNode }) => children, SchoolSupportInsertion: () => null, SchoolSupportSeatEntry: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(actions.query) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children), useRouter: () => ({ replace: actions.replace, refresh: vi.fn() }), usePathname: () => "/dashboard/followups/assessments" }));
vi.mock("@/features/school/communication-workday-actions", () => ({ createCommunicationWorklistAction: actions.create }));
vi.mock("@/features/school/assessment-assessor-actions", () => ({ reassignAssessmentAssessorAction: vi.fn() }));
vi.mock("@/features/school/enrollment-workflow-actions", () => ({ moveEnrollmentSeatAction: actions.move }));
vi.mock("@/features/school/BusinessRecordRevisionButton", () => ({ BusinessRecordRevisionButton: () => null }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children) }));
vi.mock("@/features/school/ActivityAssessmentDetails", () => ({ ActivityAssessmentDraftProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/features/school/AssessmentRecordDetails", () => ({ AssessmentRecordDetails: ({ row, onSaved }: { row: AssessmentWorkbenchRow; onSaved: (row: AssessmentWorkbenchRow) => void }) => createElement("button", { onClick: () => onSaved({ ...row, workflow: { ...row.workflow!, stage: "handled", classification: "considering" } }) }, "Save classification") }));
vi.mock("@/features/school/TeacherAssessmentEntryButton", () => ({ TeacherAssessmentEntryButton: () => null }));

let root: Root, container: HTMLDivElement;
async function render(children: ReactNode, locale: "zh" | "en" = "zh") {
  const provider: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
const click = async (button: HTMLElement) => { expect(button).toBeTruthy(); await act(async () => button.click()); };
const primary = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-followup-primary-filter] button")].find(button => button.textContent === label)!;
const keys = (attribute: string) => [...container.querySelectorAll(`[${attribute}]`)].map(row => row.getAttribute(attribute));
const at = "2026-09-07T01:00:00Z";

describe("title-bar primary filters", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.clearAllMocks();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  it.each(["zh", "en"] as const)("uses content-sized horizontal buttons with one persistent selection in %s", async locale => {
    const labels = (locale === "zh" ? zh : en).school.followupFilters;
    function Harness() {
      const [value, setValue] = useState("all");
      return createElement(FollowupPrimaryFilter, { label: labels.workQueue, value, onValueChange: setValue,
        options: ["pending", "vacancies", "full", "all"].map(value => ({ value, label: labels[`enrollments_${value}` as keyof typeof labels] })) });
    }
    await render(createElement(Harness), locale);
    const group = container.querySelector("[data-followup-primary-filter]")!;
    expect(group.className).toContain("w-fit"); expect(group.className).toContain("flex-wrap");
    expect([...group.querySelectorAll("button")].every(button => button.className.includes("whitespace-nowrap") && button.className.includes("flex-none"))).toBe(true);
    await click(primary(labels.enrollments_pending)); await click(primary(labels.enrollments_pending));
    expect(group.querySelectorAll('[data-state="on"]')).toHaveLength(1);
    expect(primary(labels.enrollments_pending).getAttribute("aria-checked")).toBe("true");
  });
  it("keeps navigation, work filters and actions in one consistent flow without breakpoint reordering", async () => {
    const stateProps = { key: "state", children: "Pages" }, filterProps = { key: "filters", children: "Work filters" }, actionProps = { key: "actions", children: "Assign" };
    const panelProps = { children: [createElement(DashboardCommandState, stateProps),
      createElement(DashboardCommandFilters, filterProps), createElement(DashboardCommandActions, actionProps)] };
    await render(createElement(FollowupCommandPanel, panelProps));
    const panel = container.querySelector("[data-dashboard-command-panel]")!;
    expect(panel.className).toContain("[&>[data-dashboard-command-slot=filters]]:contents");
    expect(panel.className).not.toContain("order-");
    expect([...panel.children].map(child => child.getAttribute("data-dashboard-command-slot"))).toEqual(["state", "filters", "actions"]);
    expect(container.querySelector('[data-dashboard-command-slot="actions"]')?.textContent).toBe("Assign");
  });
  it("switches communication work queues without dropping search/date/size or creating a worklist", async () => {
    const children = createElement(CommunicationWorkToolbar, { options: { view: "day", date: "2026-09-07" }, scope: "mine", canViewAll: true,
      canManage: true, worklists: [], pageKeys: [], count: 0, today: "2026-09-07", query: "Sample" });
    const selectionProps = { children };
    await render(createElement(CommunicationWorkSelectionProvider, selectionProps));
    expect(container.querySelectorAll("[data-followup-primary-filter] button")).toHaveLength(4);
    await click(primary(zh.school.communicationWorkday.view_unscheduled));
    const query = new URL(actions.replace.mock.calls[0][0], "http://example.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ view: "unscheduled", date: "2026-09-07", scope: "mine", q: "Sample", pageSize: "50", state: "current" });
    expect(actions.create).not.toHaveBeenCalled();
  });
  it("filters assessment stages from saved facts, shares the column filter, and retains a saved row until the next filter change", async () => {
    const rows = ["pending", "in_progress", "feedback", "handled"].map(stage => ({ id: stage, assessmentKind: "one_to_one", activityId: null,
      activityTitle: "", publicClassRecord: null, invitationId: stage, registrationId: null, studentId: null, leadId: null,
      name: stage, phone: "", grade: 3, gradeText: "", scheduledAt: at, location: "", assessorId: null, assessorName: "",
      assessorSource: "assigned", background: "", participationStatus: stage === "pending" ? "booked" : "attended", assessmentStartedAt: stage === "in_progress" ? at : null, assessmentCompletedAt: ["feedback", "handled"].includes(stage) ? at : null,
      assessment: null, questionSummary: null, route: null, updatedAt: at,
      workflow: assessmentWorkflowFromDb({ id: "00000000-0000-4000-8000-000000000001", registration_id: "00000000-0000-4000-8000-000000000001",
        stage, revision: 1, arrived_at: null, report_id: null, report: null, sent_report_id: null, sent_at: null, sent_by: null,
        classification: stage === "handled" ? "considering" : null, parent_response: "", reasons: [], next_contact_at: null, finalized_at: null, revision_reason: "",
        updated_by: "00000000-0000-4000-8000-000000000001", updated_at: at }),
    })) as AssessmentWorkbenchRow[];
    await render(createElement(AssessmentUnifiedWorkbench, { initialRows: rows, assessors: [], locale: "zh", canAssess: false, canSupport: true, canManageAssessor: false }));
    const labels = zh.school.followupFilters;
    for (const stage of ["pending", "in_progress", "feedback", "handled"] as const) {
      await click(primary(labels[`assessments_${stage}`]));
      expect(keys("data-followup-row-key")).toEqual([stage]);
    }
    await click(primary(labels.assessments_feedback));
    await click(container.querySelector<HTMLElement>('[data-followup-row-key="feedback"]')!);
    await click([...container.querySelectorAll("button")].find(button => button.textContent === "Save classification")!);
    expect(keys("data-followup-row-key")).toEqual(["feedback"]);
    await click(primary(labels.assessments_handled)); expect(keys("data-followup-row-key")).toEqual(["feedback", "handled"]);
    await click(primary(labels.assessments_all)); expect(keys("data-followup-row-key")).toHaveLength(4);
  });
  it("shows the next server page after saving a row on the previous page", async () => {
    const row = (id: string): AssessmentWorkbenchRow => ({ id, assessmentKind: "one_to_one", activityId: null,
      activityTitle: "", publicClassRecord: null, invitationId: id, registrationId: null, studentId: null, leadId: null,
      name: id, phone: "", grade: 3, gradeText: "", scheduledAt: at, location: "", assessorId: null, assessorName: "",
      assessorSource: "assigned", background: "", participationStatus: "booked", assessmentStartedAt: null, assessmentCompletedAt: null,
      assessment: null, questionSummary: null, route: null, updatedAt: at });
    const page = async (number: number) => {
      const rows = [row(`page-${number}`)];
      const fields = { version: 2 as const, filters: {}, sort: null };
      await render(createElement(AssessmentUnifiedWorkbench, { initialRows: rows, assessors: [], locale: "zh", canAssess: false,
        canSupport: true, canManageAssessor: false, pageControl: { q: "", state: "current", fields, pending: false,
          onSearch: vi.fn(), onState: vi.fn(), onFields: vi.fn(), onPage: vi.fn(),
          data: { rows, count: 21, page: number, pageSize: 20, totalPages: 2, q: "", state: "current", fieldView: { query: fields, facets: {} } } } }));
    };
    await page(1);
    await click(container.querySelector<HTMLElement>('[data-followup-row-key="page-1"]')!);
    await click([...container.querySelectorAll("button")].find(button => button.textContent === "Save classification")!);
    expect(keys("data-followup-row-key")).toEqual(["page-1"]);
    await page(2);
    expect(keys("data-followup-row-key")).toEqual(["page-2"]);
  });
  it("keeps target classrooms and occupied seats visible for pending placement and filters by real class capacity", async () => {
    const classroom = (id: string, grade: number, capacity: number | null, activeCount: number) => ({ id, name: id, courseId: `course-${grade}`, termId: "term",
      capacity, activeCount, operationalStatus: "active" as const, teacherNames: "", sessions: [] });
    const board: EnrollmentPlacementBoard = { options: { terms: [
      { id: "term", name: "Term", isCurrent: true, startsOn: "2026-09-01", endsOn: "2027-01-01" },
      { id: "previous", name: "Previous term", isCurrent: false, startsOn: "2026-02-01", endsOn: "2026-06-30" }],
      courses: [3, 4].map(grade => ({ id: `course-${grade}`, title: "Course", grade, productCode: null, classType: "standard" })),
      classrooms: [classroom("open", 3, 2, 1), classroom("full", 3, 1, 1), classroom("unlimited", 4, null, 0), { ...classroom("previous-class", 3, 2, 0), termId: "previous" }] },
      members: ["open", "full"].map(classroomId => ({ membershipId: classroomId, classroomId, studentId: classroomId, name: `Occupant ${classroomId}`,
        phone: "", enrollmentId: null, note: "", recommendation: "", seat: 1 })),
      enrollments: [{ id: "pending", opportunityId: "pending", studentId: "pending", studentName: "Pending", studentPhone: "", courseId: "course-3", courseTitle: "Course",
        termId: "term", termName: "Term", status: "active", note: "", confirmedAt: at, confirmedByName: "", cancelledAt: null, cancelledByName: null,
        assignmentId: null, classroomId: null, classroomName: null, membershipId: null, assignedAt: null, claimableClassroomIds: [], updatedAt: at }] };
    await render(createElement(EnrollmentPlacementWorkbench, { initialBoard: board, canCreateClass: true, canTeach: true, workspace: "classes", workspaceQuery: { state: "historical" } }));
    const labels = zh.school.followupFilters;
    const panel = container.querySelector('[data-dashboard-command-panel]')!;
    expect([...panel.children].map(child => child.getAttribute("data-dashboard-command-slot"))).toEqual(["state", "filters", "actions"]);
    expect(panel.textContent).not.toContain("班级名册"); expect(panel.textContent).not.toContain("教学记录");
    expect(panel.textContent).not.toContain("建班");
    expect(container.querySelector('[data-followup-primary-filter]')).toBeNull();
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="班级操作"]')!);
    expect(document.body.textContent).not.toMatch(/当前工作|历史记录|全部记录/);
    await click(primary(labels.enrollments_pending));
    expect(keys("data-placement-classroom")).toEqual(["full", "open"]);
    expect(container.textContent).toContain("Occupant full"); expect(container.textContent).toContain("Occupant open");
    await click(primary(labels.enrollments_vacancies)); expect(keys("data-placement-classroom")).toEqual(["open", "unlimited"]);
    await click(primary(labels.enrollments_full)); expect(keys("data-placement-classroom")).toEqual(["full"]);
    await click(primary(labels.enrollments_all));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await click([...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === zh.school.teachingWorkbench.time.previous_term)!);
    expect(keys("data-placement-classroom")).toEqual(["previous-class"]);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="班级操作"]')!);
    const teaching = [...document.querySelectorAll("a")].find(link => link.textContent === "完成情况")!;
    expect(new URL(teaching.href).searchParams.get("term")).toBe("previous");
    expect(new URL(teaching.href).searchParams.has("state")).toBe(false);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await click([...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === zh.school.teachingWorkbench.time.current_term)!);
    expect(keys("data-placement-classroom")).toEqual(["full", "open", "unlimited"]);
    expect(actions.move).not.toHaveBeenCalled();
  });
});
