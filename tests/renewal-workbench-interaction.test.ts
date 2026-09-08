// @vitest-environment jsdom
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { RenewalEntryRow, type RenewalPoolRow } from "@/features/school/RenewalRecordDetails";
import { RenewalStudentPool } from "@/features/school/RenewalStudentPool";
import { DEFAULT_RENEWAL_HEALTH_POLICY } from "@/features/school/renewal-health-policy";
import type { RenewalWorkbenchSaved } from "@/features/school/renewal-workbench-contract";
import type { RenewalWorkspaceData } from "@/features/school/renewals";
import type { RenewalPoolSupplement } from "@/features/school/renewal-pool-data";

const actions = vi.hoisted(() => ({ save: vi.fn(), observe: vi.fn(), refresh: vi.fn(), saved: vi.fn(), error: vi.fn() }));
// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportInlineEntry", () => ({ SchoolSupportTableEntry: ({ children }: { children: import("react").ReactNode }) => children, SchoolSupportInsertion: () => null, SchoolSupportSeatEntry: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/renewal-workbench-actions", () => ({ saveRenewalWorkbenchAction: actions.save }));
vi.mock("@/features/school/actions/renewals", () => ({ createTeacherProfessionalSignalAction: actions.observe,
  setRenewalCycleStatusAction: vi.fn(), snapshotRenewalCycleMembershipsAction: vi.fn() }));
vi.mock("@/features/school/BusinessRecordRevisionButton", () => ({ BusinessRecordRevisionButton: () => createElement("span", null, "Historical revision") }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children) }));
vi.mock("@/features/school/RenewalPoolWorkspace", () => ({ CreateCycleDialog: () => null }));
vi.mock("@/features/school/RenewalHealthSettings", () => ({ RenewalHealthSettings: () => null }));
vi.mock("@/features/school/FollowupTabs", () => ({ FollowupTabs: () => createElement("nav", null, "Follow-up") }));
vi.mock("@/features/school/dashboard-page/FollowupChoice", async importOriginal => {
  const actual = await importOriginal<typeof import("@/features/school/dashboard-page/FollowupChoice")>();
  return { ...actual, FollowupChoice: ({ label, disabled, value, onValueChange, options }: {
    label: string; disabled: boolean; value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[];
  }) => createElement("select", { "aria-label": label, disabled, value, onChange: (event: { currentTarget: HTMLSelectElement }) => onValueChange(event.currentTarget.value) },
    ...options.map(option => createElement("option", { key: option.value, value: option.value }, option.label))) };
});
vi.mock("@/components/ui/date-time-picker", () => ({ DateTimePicker: ({ id, value, disabled, onValueChange }: {
  id: string; value: string; disabled: boolean; onValueChange: (value: string) => void;
}) => createElement("input", { id, value, disabled, onChange: (event: { currentTarget: HTMLInputElement }) => onValueChange(event.currentTarget.value) }) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ refresh: actions.refresh, replace: vi.fn() }), usePathname: () => "/dashboard/followups/renewals" }));
vi.mock("sonner", () => ({ toast: { error: actions.error, success: vi.fn() } }));

const id = "00000000-0000-4000-8000-000000000001";
const nextId = "00000000-0000-4000-8000-000000000002";
const time = "2026-09-07T03:00:00Z";
const initial: RenewalPoolRow = { id, membershipId: id, studentId: id, name: "Sample student", phone: "", grade: 3,
  classroom: "Sample class", teacher: "Sample teacher", owner: "Sample owner", stage: "considering", note: "Saved concern", opportunityId: id,
  targetCourse: "Sample course", nextContactAt: null, updatedAt: time };
const response = (revision = 1): RenewalWorkbenchSaved => ({ record: { opportunityId: id, revision, contactMethod: "parent_meeting",
  seasons: ["winter", "spring"], paidOn: null, paymentMethod: null, updatedAt: time }, stage: "considering", note: "Saved draft", nextContactAt: null, payment: null });
const t = zh.school.renewals.workbench;

function Harness({ initialRow = initial, serverRow, canWrite = true, canEnroll = true }: { initialRow?: RenewalPoolRow; serverRow?: RenewalPoolRow; canWrite?: boolean; canEnroll?: boolean }) {
  const [row, setRow] = useState(initialRow), [active, setActive] = useState(true), [busy, setBusy] = useState(false);
  return createElement("table", null, createElement("tbody", null, createElement(RenewalEntryRow, {
    row: serverRow ?? row, cycleId: id, cycleName: "Renewal cycle", targetTerm: "Target term", health: [], healthAvailable: true,
    policy: DEFAULT_RENEWAL_HEALTH_POLICY, observation: "Saved teacher observation", now: Date.parse(time), sampleMode: false,
    canWrite, canEnroll, canObserve: canWrite, active, busy, canAdvance: true, onBusy: setBusy,
    onActivate: () => setActive(true), onClose: () => setActive(false), onObservationSaved: () => {},
    onSaved: (value, advance) => { actions.saved(value, advance); setRow(current => ({ ...current, opportunityId: value.record.opportunityId,
      stage: value.stage, note: value.note, nextContactAt: value.nextContactAt, record: value.record, payment: value.payment ?? undefined })); },
  })));
}

let root: Root, container: HTMLDivElement;
const render = async (children: ReactNode, locale: "zh" | "en" = "zh") => {
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, props)));
};
const mount = async (props: ComponentProps<typeof Harness> = {}, locale: "zh" | "en" = "zh") => render(createElement(Harness, props), locale);
const fill = async (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
  const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
};
const choice = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const note = () => container.querySelector<HTMLTextAreaElement>("[data-followup-notes] textarea")!;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const panel = async (value: string) => click(container.querySelector<HTMLButtonElement>(`[data-renewal-stage="${value}"]`)!);
const save = async (advance = false) => click(advance ? button(zh.school.followupEntry.saveAndNext)
  : container.querySelector<HTMLButtonElement>("[data-followup-entry-actions] button[aria-keyshortcuts]")!);

describe("renewal worksheet interaction", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.clearAllMocks(); actions.save.mockResolvedValue({ ok: true, data: response() }); actions.observe.mockResolvedValue({ ok: true });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(["zh", "en"] as const)("keeps one tag strip and right sidebar above/beside every %s step without saving on navigation", async locale => {
    await mount({}, locale);
    const tags = container.querySelector("[data-renewal-tags]")!, sidebar = container.querySelector("[data-followup-notes]")!;
    await fill(note(), "Unsaved family concern");
    for (const value of ["learning", "registration", "communication"]) {
      await panel(value);
      expect(container.querySelector("[data-renewal-tags]")).toBe(tags);
      expect(tags.querySelectorAll("[data-followup-field-icon]")).toHaveLength(3);
      expect(tags.compareDocumentPosition(container.querySelector("[data-renewal-progress]")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelectorAll("[data-followup-notes]")).toHaveLength(1);
      expect(container.querySelector("[data-followup-notes]")).toBe(sidebar);
      expect(note().value).toBe("Unsaved family concern");
      expect(container.querySelector(`[data-renewal-panel="${value}"]`)?.hasAttribute("hidden")).toBe(false);
    }
    expect(actions.save).not.toHaveBeenCalled(); expect(actions.observe).not.toHaveBeenCalled();
  });
  it("roundtrips simultaneous winter/spring choices and the Shanghai next-contact time in a single explicit save", async () => {
    await mount(); await fill(choice(t.contactMethod), "parent_meeting");
    await click(button(t.season_winter)); await click(button(t.season_spring)); await fill(note(), "Family feedback");
    await fill(container.querySelector<HTMLInputElement>(`[id="renewal-entry-${id}-next"]`)!, "2026-09-09T14:30");
    await save();
    expect(actions.save).toHaveBeenCalledExactlyOnceWith({ cycleId: id, membershipId: id, expectedRevision: 0, result: "considering",
      note: "Family feedback", contactMethod: "parent_meeting", seasons: ["winter", "spring"], nextContactAt: "2026-09-09T06:30:00.000Z",
      periodCount: null, paidAmount: null, paidOn: null, paymentMethod: null });
    expect(actions.saved).toHaveBeenLastCalledWith(response(), false);
    expect(container.querySelector("[data-followup-inline-details]")?.hasAttribute("hidden")).toBe(false);
  });
  it("requires actual payment fields and retains them when switching results or closing the row", async () => {
    await mount(); await fill(choice(t.result), "paid");
    expect(container.querySelector<HTMLButtonElement>("[data-followup-entry-actions] button[aria-keyshortcuts]")!.disabled).toBe(true);
    await fill(container.querySelector<HTMLInputElement>(`[id="renewal-entry-${id}-periods"]`)!, "2");
    await fill(container.querySelector<HTMLInputElement>(`[id="renewal-entry-${id}-amount"]`)!, "3200.50");
    await fill(container.querySelector<HTMLInputElement>(`[id="renewal-entry-${id}-paidOn"]`)!, "2026-09-01");
    await fill(choice(t.paymentMethod), "wechat"); await fill(choice(t.result), "considering"); await fill(choice(t.result), "paid");
    expect(container.querySelector<HTMLInputElement>(`[id="renewal-entry-${id}-amount"]`)!.value).toBe("3200.50");
    const sidebar = container.querySelector("[data-followup-notes]");
    const toggle = container.querySelector<HTMLButtonElement>("[data-followup-person] button[aria-expanded]")!;
    await click(toggle); await click(toggle);
    expect(container.querySelector("[data-followup-notes]")).toBe(sidebar);
    await save(true);
    expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ result: "paid", periodCount: 2, paidAmount: 3200.5,
      paidOn: "2026-09-01", paymentMethod: "wechat", nextContactAt: null }));
    expect(actions.saved).toHaveBeenLastCalledWith(response(), true);
  });
  it("confirms enrollment without inventing a payment", async () => {
    await mount(); await fill(choice(t.result), "registered"); await save();
    expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({ result: "registered", paidOn: null,
      paymentMethod: null, paidAmount: null, periodCount: null }));
  });
  it("keeps failed/conflicting drafts and does not advance or silently retry with a newer version", async () => {
    actions.save.mockResolvedValue({ ok: false, code: "RENEWAL_WORKBENCH_CONFLICT" });
    await mount(); await fill(note(), "Keep my draft"); await save(true);
    expect(note().value).toBe("Keep my draft"); expect(actions.saved).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t.conflict);
    expect(container.querySelector<HTMLButtonElement>("[data-followup-entry-actions] button[aria-keyshortcuts]")!.disabled).toBe(true);
    await panel("registration"); expect(note().value).toBe("Keep my draft");
  });
  it.each([false, true])("adopts refreshed facts only for pristine drafts (dirty=%s)", async dirty => {
    await mount({ serverRow: initial });
    if (dirty) await fill(note(), "Unsaved local concern");
    const incoming = { ...initial, note: "New saved concern", record: response(2).record };
    await mount({ serverRow: incoming });
    expect(note().value).toBe(dirty ? "Unsaved local concern" : "New saved concern");
    await save();
    expect(actions.save).toHaveBeenLastCalledWith(expect.objectContaining({
      note: dirty ? "Unsaved local concern" : "New saved concern", expectedRevision: dirty ? 0 : 2,
    }));
  });
  it("uses Ctrl+Enter to save the current record and isolates the teacher observation draft", async () => {
    await mount(); await panel("learning"); await fill(note(), "Separate parent concern");
    const teacher = container.querySelector<HTMLTextAreaElement>("[data-renewal-teacher-entry] textarea")!;
    await fill(teacher, "New learning observation");
    await act(async () => teacher.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
    expect(actions.observe).toHaveBeenCalledTimes(1); expect(actions.save).not.toHaveBeenCalled();
    expect(note().value).toBe("Separate parent concern");
    await act(async () => note().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
    expect(actions.save).toHaveBeenCalledTimes(1); expect(actions.saved).toHaveBeenLastCalledWith(response(), false);
  });
  it("blocks double submission and freezes tags while a save is pending", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount();
    const submit = container.querySelector<HTMLButtonElement>("[data-followup-entry-actions] button[aria-keyshortcuts]")!;
    await act(async () => { submit.click(); submit.click(); });
    expect(actions.save).toHaveBeenCalledTimes(1); expect(choice(t.result).disabled).toBe(true);
    expect(note().disabled).toBe(true);
    await act(async () => finish({ ok: true, data: response() }));
    expect(choice(t.result).disabled).toBe(false);
  });
  it("keeps permission-limited entries read-only while allowing step browsing", async () => {
    await mount({ canWrite: false }); await panel("registration");
    expect(choice(t.result).disabled).toBe(true); expect(container.querySelector("[data-followup-notes] textarea")).toBeNull();
    expect(container.querySelector("[data-followup-entry-actions] button[aria-keyshortcuts]")).toBeNull();
    expect(actions.save).not.toHaveBeenCalled();
  });
  it("shows historical facts without current renewal or teacher-write controls", async () => {
    await mount({ initialRow: { ...initial, membershipId: null, stage: "enrolled", recordState: "historical" } });
    for (const value of ["learning", "communication", "registration"]) await panel(value);
    expect(choice(t.result)).toBeNull(); expect(choice(t.contactMethod).disabled).toBe(true);
    expect(container.querySelector("[data-followup-notes] textarea")).toBeNull();
    expect(container.querySelector("[data-followup-entry-actions] button[aria-keyshortcuts]")).toBeNull();
    expect(container.querySelector("[data-renewal-teacher-entry]")).toBeNull();
    expect(container.textContent).toContain(initial.note);
    expect(actions.save).not.toHaveBeenCalled(); expect(actions.observe).not.toHaveBeenCalled();
  });
  it("does not let non-enrollment staff select paid or enrolled with keyboard shortcuts", async () => {
    await mount({ canEnroll: false });
    expect([...choice(t.result).options].map(option => option.value)).not.toContain("paid");
    const summary = container.querySelector<HTMLElement>("[data-renewal-pool-row]")!;
    await act(async () => summary.dispatchEvent(new KeyboardEvent("keydown", { key: "4", bubbles: true })));
    expect(choice(t.result).value).toBe("considering"); expect(actions.save).not.toHaveBeenCalled();
  });
  it("retains the current list and row after refresh moves a candidate into an opportunity", async () => {
    const candidate = (membershipId: string) => ({ membershipId, studentId: membershipId, studentName: membershipId === id ? "First student" : "Second student",
      grade: 3, classroomId: id, classroomName: "Sample class", sourceCourseId: id, sourceCourseTitle: "Course", currentOwnerId: id, currentOwnerName: "Owner", ready: true });
    const data: RenewalWorkspaceData = { selectedCycleId: id, cycles: [{ id, name: "Renewal cycle", campusId: id,
      sourceTermId: id, sourceTermName: "Source", targetTermId: nextId, targetTermName: "Target", status: "open",
      preparationStartsOn: null, decisionDueOn: null, opportunityCount: 0, createdAt: time }], candidates: [candidate(id), candidate(nextId)], opportunities: [], courses: [], terms: [] };
    const supplement: RenewalPoolSupplement = { health: [], healthAvailable: true, healthPolicy: DEFAULT_RENEWAL_HEALTH_POLICY,
      healthPolicyRevision: 0, payments: [], signals: [], records: [], students: [], membershipTeachers: [], now: Date.parse(time), observationMemberships: [] };
    const app = (values: RenewalWorkspaceData) => createElement(RenewalStudentPool, { data: values, supplement, canWrite: true, canEnroll: true, canReview: false });
    await render(app(data));
    await click(button(zh.school.followupFilters.renewals_uncontacted));
    await click(container.querySelector<HTMLButtonElement>(`[data-renewal-pool-row="${id}"] [aria-expanded]`)!); await save();
    const sidebar = container.querySelector("[data-followup-notes]");
    await render(app({ ...data, candidates: [candidate(nextId)], opportunities: [{ id, opportunityType: "renewal", studentId: id,
      studentName: "First student", grade: 3, courseId: id, courseTitle: "Course", termId: nextId, termName: "Target", stage: "considering",
      ownerId: id, ownerName: "Owner", nextAction: "", nextActionAt: null, note: "Saved draft", cycleId: id, cycleName: "Renewal cycle",
      sourceMembershipId: id, sourceClassroomName: "Sample class", createdAt: time, updatedAt: time }] }));
    expect([...container.querySelectorAll<HTMLElement>("[data-renewal-pool-row]")].map(row => row.dataset.renewalPoolRow)).toEqual([id, nextId]);
    expect(container.querySelector("[data-followup-notes]")).toBe(sidebar);
    expect(container.querySelector(`[data-renewal-pool-row="${id}"]`)?.getAttribute("aria-expanded")).toBe("true");
    await click(button(zh.school.followupFilters.renewals_following));
    expect([...container.querySelectorAll<HTMLElement>("[data-renewal-pool-row]")].map(row => row.dataset.renewalPoolRow)).toEqual([id]);
    await click(button(zh.school.followupFilters.renewals_payment));
    expect(container.querySelectorAll("[data-renewal-pool-row]")).toHaveLength(0);
  });
});
