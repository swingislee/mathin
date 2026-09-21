// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { LeadIntakeWorkbench } from "@/features/school/LeadIntakeWorkbench";
import { LeadIntakeScopeFilter } from "@/features/school/LeadIntakeScopeFilter";
import { LeadPoolBatchActions, LeadPoolSelectionProvider } from "@/features/school/LeadPoolSelection";
import type { LeadPoolFilters, LeadPoolRow } from "@/features/school/lead-contract";
import type { DashboardTableFieldHeaderProps } from "@/features/school/dashboard-page/DashboardTableFieldMenu";

const actions = vi.hoisted(() => ({ assign: vi.fn(), refresh: vi.fn(), replace: vi.fn(), open360: vi.fn(), error: vi.fn() }));
// 补入流程有独立合同测试；这些用例继续覆盖原工作表交互。
vi.mock("@/features/school/SchoolSupportInlineEntry", () => ({ SchoolSupportTableEntry: ({ children }: { children: import("react").ReactNode }) => children, SchoolSupportInsertion: () => null, SchoolSupportSeatEntry: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock("@/features/school/actions/leads", () => ({ assignLeadsAction: actions.assign }));
vi.mock("@/features/school/LeadIdentityControl", () => ({ LeadIdentityControl: () => createElement("button", { type: "button", "data-identity-control": true }, "Confirm identity") }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children, subject, className }: {
  children: ReactNode; subject: unknown; className?: string;
}) => createElement("button", { type: "button", "data-open-student": true, className, onClick: () => actions.open360(subject) }, children) }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ refresh: actions.refresh, replace: actions.replace }), usePathname: () => "/dashboard/followups/leads" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: { error: actions.error, success: vi.fn() } }));
vi.mock("@/features/school/dashboard-page/DashboardTableColumnHeader", () => ({ DashboardTableColumnHeader: ({
  label, fields,
}: DashboardTableFieldHeaderProps) => createElement("div", { "data-column-scope": label },
  ...fields.filter(field => field.kind === "enum").map((field, index) => createElement("select", { key: field.id, "aria-label": index === 0 ? label : field.label,
    value: field.filter?.kind === "enum" ? field.filter.values[0] : "", onChange: (event: { currentTarget: HTMLSelectElement }) => field.onFilterChange(event.currentTarget.value ? { kind: "enum", values: [event.currentTarget.value] } : undefined) },
    createElement("option", { value: "" }, label), ...field.options.map(option => createElement("option", { key: option.value, value: option.value }, option.label)))),
  createElement("button", { type: "button", "aria-label": `${label} ascending`, onClick: () => fields[0].onSortChange?.("asc") }, "Sort")) }));
vi.mock("@/features/school/dashboard-page/FollowupChoice", async importOriginal => {
  const original = await importOriginal<typeof import("@/features/school/dashboard-page/FollowupChoice")>();
  return { ...original, FollowupChoice: ({ label, value, disabled, options, onValueChange }: {
    label: string; value: string; disabled: boolean; options: { value: string; label: string }[]; onValueChange: (value: string) => void;
  }) => createElement("select", { "aria-label": label, value, disabled, onChange: (event: { currentTarget: HTMLSelectElement }) => onValueChange(event.currentTarget.value) },
    createElement("option", { value: "" }, label), ...options.map(option => createElement("option", { key: option.value, value: option.value }, option.label))) };
});

const t = zh.school.leads;
const ids = ["lead-1", "lead-2", "lead-3", "lead-4"];
const fixture = (id: string, values: Partial<LeadPoolRow>): LeadPoolRow => ({ id,
  provisionalStudentName: "Sample name", phone: "10000000000", gradeHint: 1, gradeText: "", status: "uncontacted",
  ownerId: null, ownerName: "", studentId: null, suggestedStudentId: null, suggestedStudentName: "",
  createdAt: "2026-09-01T02:00:00Z", acquiredAt: "2026-09-01T02:00:00Z", acquisitionLocation: "Sample park",
  acquisitionMethod: "Sample method", acquisitionPromoter: "Sample promoter", sourceCount: 1, sourceMarkedDuplicate: false,
  interests: ["Sample activity"], contactCount: 0, lastContactAt: null, lastContactOutcome: null, lastContactNote: "",
  wechatAdded: null, visitCommitted: null, interestLevel: null, nextContactAt: null, activeInvitation: null, ...values });
const rows = [
  fixture(ids[0], { provisionalStudentName: "Zoe", sourceMarkedDuplicate: true }),
  fixture(ids[1], { provisionalStudentName: "Ada", gradeHint: 2, acquisitionLocation: "Sample library", phone: "10000000001" }),
  fixture(ids[2], { provisionalStudentName: "Bo", ownerId: "owner-1", ownerName: "Sample owner", studentId: "student-3",
    status: "contacted", lastContactOutcome: "connected", contactCount: 1, lastContactNote: "Saved family concern", lastContactAt: "2026-09-02T03:00:00Z" }),
  fixture(ids[3], { provisionalStudentName: "Closed", status: "invalid" }),
];
const filters: LeadPoolFilters = { scope: "all", page: 3, pageSize: 50, q: "sample name", status: "uncontacted" };
const assignees = [{ userId: "owner-1", displayName: "Sample owner" }, { userId: "owner-2", displayName: "Next owner" }];
let container: HTMLDivElement, root: Root;
const render = async ({ locale = "zh", canAssign = true, poolKey = "default" }: { locale?: "zh" | "en"; canAssign?: boolean; poolKey?: string } = {}) => {
  const poolProps: ComponentProps<typeof LeadPoolSelectionProvider> = { assignableIds: ids.slice(0, 3), children: [
    createElement("div", { key: "commands", "data-command-actions": true },
      createElement(LeadIntakeScopeFilter, { filters: canAssign ? filters : { ...filters, scope: "mine" }, canScopeAll: canAssign }),
      canAssign ? createElement(LeadPoolBatchActions, { assignees }) : null),
    createElement(LeadIntakeWorkbench, { key: "table", leads: rows, locale, canAssign, canManageIdentity: canAssign, currentUserId: "sample-user" }),
  ] };
  const children = createElement(LeadPoolSelectionProvider, { ...poolProps, key: poolKey });
  const props: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, props)));
};
const row = (id: string) => container.querySelector<HTMLTableRowElement>(`[data-lead-intake-row="${id}"]`)!;
const select = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const checkbox = (id: string) => row(id).querySelector<HTMLButtonElement>("[role=checkbox]")!;
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label)!;
const click = async (element: HTMLElement, shiftKey = false) => act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })); });
const choose = async (label: string, value: string) => act(async () => {
  const element = select(label);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("change", { bubbles: true }));
});
const key = async (element: HTMLElement, value: string, extra: KeyboardEventInit = {}) => act(async () => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, ...extra }));
});

describe("compact lead intake worksheet", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn(); vi.clearAllMocks();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    actions.assign.mockResolvedValue({ ok: true });
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(["zh", "en"] as const)("keeps %s summaries single-line and all seven data columns independently filterable", async locale => {
    await render({ locale });
    expect(container.querySelector("[data-lead-intake-workbench][data-followup-workbench][data-followup-scroll]")).not.toBeNull();
    for (const id of ids) {
      expect(row(id).classList.contains("h-9")).toBe(true);
      expect(row(id).querySelectorAll("td")).toHaveLength(9);
      expect(row(id).querySelector("p,[data-identity-control]")).toBeNull();
    }
    expect(container.querySelectorAll("[data-column-scope]")).toHaveLength(7);
    expect(container.querySelector("[data-followup-inline-details]")).toBeNull();
    expect(container.querySelector("tbody input,tbody textarea")).toBeNull();
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it("opens the same student in 360 without opening details or assigning", async () => {
    await render(); await click(row(ids[2]).querySelector<HTMLElement>("[data-open-student]")!);
    expect(actions.open360).toHaveBeenCalledExactlyOnceWith({ leadId: ids[2], studentId: "student-3" });
    expect(container.querySelector("[data-followup-inline-details]")).toBeNull();
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it("keeps source and identity on the left, existing notes on the right and contact editing in communication", async () => {
    await render(); await click(row(ids[2]).querySelector<HTMLElement>("[data-lead-details-trigger]")!);
    const details = container.querySelector("[data-lead-intake-details]")!;
    expect(details.querySelector("[data-followup-business]")?.textContent).toContain("Sample promoter");
    expect(details.querySelector("[data-followup-business] [data-identity-control]")).not.toBeNull();
    expect(details.querySelector("[data-followup-notes]")?.textContent).toContain("Saved family concern");
    expect(details.querySelector("textarea,input,[data-followup-progress]")).toBeNull();
    expect(details.querySelector("a")?.getAttribute("href")).toBe(`/dashboard/communication?lead=${ids[2]}`);
    await key(row(ids[2]), "Escape");
    expect(container.querySelector("[data-lead-intake-details]")).toBeNull();
  });
  it("moves focus without expanding summaries and supports keyboard range selection", async () => {
    await render(); await act(async () => row(ids[0]).focus()); await key(row(ids[0]), "ArrowDown");
    expect(document.activeElement).toBe(row(ids[1])); expect(container.querySelector("[data-followup-inline-details]")).toBeNull();
    await key(row(ids[0]), " "); await key(row(ids[2]), " ", { shiftKey: true });
    expect(ids.slice(0, 3).map(id => checkbox(id).getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    expect(checkbox(ids[3]).disabled).toBe(true);
    await key(row(ids[0]), "Enter"); await key(row(ids[0]), "ArrowDown");
    expect(row(ids[1]).getAttribute("aria-expanded")).toBe("true");
    expect(actions.assign).not.toHaveBeenCalled();
  });
  it("combines grade and owner filters, shows hidden selections, and assigns the explicit selected set", async () => {
    await render(); await choose(t.grade, "1");
    await click(container.querySelector<HTMLButtonElement>("thead [role=checkbox]")!);
    await choose(t.owner, "owner-1");
    expect(container.querySelectorAll("[data-lead-intake-row]")).toHaveLength(1);
    expect(container.querySelector("[data-command-actions]")?.textContent).toContain("已选 2 条");
    expect(container.querySelector("[data-command-actions]")?.textContent).toContain("含筛选外 1 条");
    await choose(t.chooseAssignee, "owner-2"); await click(button(t.assignSelected));
    expect(actions.assign).toHaveBeenCalledExactlyOnceWith([ids[0], ids[2]], "owner-2");
    expect(actions.refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-command-actions] [role=status]")).toBeNull();
  });
  it("uses the sorted visible order for Shift selection and clears hidden selections and their anchor", async () => {
    await render(); await click(button(`${zh.school.table.fieldName} ascending`));
    await click(checkbox(ids[1])); await click(checkbox(ids[0]), true);
    expect(ids.slice(0, 3).every(id => checkbox(id).getAttribute("aria-checked") === "true")).toBe(true);
    await choose(t.grade, "2"); await click(button(t.clearSelection));
    expect(checkbox(ids[1]).getAttribute("aria-checked")).toBe("false");
    await choose(t.grade, ""); await click(checkbox(ids[2]), true);
    expect(ids.slice(0, 3).map(id => checkbox(id).getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });
  it("keeps selected rows and owner after an assignment failure", async () => {
    actions.assign.mockResolvedValue({ ok: false, code: "LEAD_SCOPE_MISMATCH" });
    await render(); await click(checkbox(ids[0])); await choose(t.chooseAssignee, "owner-2"); await click(button(t.assignSelected));
    expect(checkbox(ids[0]).getAttribute("aria-checked")).toBe("true");
    expect(select(t.chooseAssignee).value).toBe("owner-2");
    expect(actions.error).toHaveBeenCalledWith(t.assignmentStale); expect(actions.refresh).not.toHaveBeenCalled();
  });
  it("freezes scope, selection and owner and blocks double submit while assignment is pending", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    actions.assign.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click(checkbox(ids[0])); await choose(t.chooseAssignee, "owner-2");
    await act(async () => { button(t.assignSelected).click(); button(t.assignSelected).click(); });
    expect(actions.assign).toHaveBeenCalledTimes(1); expect(checkbox(ids[1]).disabled).toBe(true);
    expect(select("查看范围").disabled).toBe(true); expect(select(t.chooseAssignee).disabled).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-followup-primary-filter] button")].every(button => button.disabled)).toBe(true);
    expect(button(t.clearSelection).disabled).toBe(true);
    await act(async () => finish({ ok: true }));
  });
  it("resets the page on scope change, preserves the query context and clears selection when the page scope remounts", async () => {
    await render(); await click(checkbox(ids[0])); await click(button(zh.school.followupFilters.leads_unassigned));
    const url = new URL(actions.replace.mock.calls[0][0], "http://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ scope: "unassigned", pageSize: "50", status: "uncontacted", q: "sample name" });
    await render({ poolKey: "changed-scope" });
    expect(checkbox(ids[0]).getAttribute("aria-checked")).toBe("false"); expect(actions.assign).not.toHaveBeenCalled();
  });
  it("keeps a permission-limited view browsable without assignment or identity-write controls", async () => {
    await render({ canAssign: false });
    expect(container.querySelector("[role=checkbox]")).toBeNull(); expect(select("查看范围")).not.toBeNull();
    expect(container.querySelector('[data-followup-primary-filter]')?.textContent).toContain(zh.school.followupFilters.leads_unassigned);
    expect(container.querySelectorAll('[data-followup-primary-filter] button')).toHaveLength(3);
    expect(button(zh.school.followupFilters.leads_assigned).disabled).toBe(false);
    await key(row(ids[0]), "Enter");
    expect(container.querySelector("[data-lead-intake-details]")).not.toBeNull();
    expect(container.querySelector("[data-identity-control]")).toBeNull();
    expect(row(ids[0]).querySelectorAll("td")).toHaveLength(8);
    await key(row(ids[0]), " "); expect(actions.assign).not.toHaveBeenCalled();
  });
});
