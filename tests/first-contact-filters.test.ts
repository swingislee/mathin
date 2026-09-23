// @vitest-environment jsdom
import { act, createElement as h, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { InvitationCoordinationWorkbench } from "@/features/school/InvitationCoordinationWorkbench";
import { CommunicationWorkSelectionProvider } from "@/features/school/CommunicationWorkSelection";
import { dashboardFieldMessages } from "@/features/school/dashboard-page/dashboard-field-messages";
import { firstContactRowMessages } from "@/features/school/first-contact-row-messages";
import { followupFieldPage, type FollowupServerFields } from "@/features/school/followup-table-page";
import { studentStageTableFields } from "@/features/school/student-stage-table-fields";
import type { StudentStageRow } from "@/features/school/student-stage-contract";
import type { LeadPoolRow } from "@/features/school/lead-contract";

const deps = vi.hoisted(() => ({ facets: vi.fn(), replace: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/SchoolSupportInlineEntry", () => ({ SchoolSupportTableEntry: ({ children }: { children: ReactNode }) => children, SchoolSupportInsertion: () => null, SchoolSupportSeatEntry: () => null }));
vi.mock("@/features/school/SchoolSupportPendingRows", () => ({ SchoolSupportPendingRows: () => null }));
vi.mock("@/features/school/actions/invitations", () => ({ updateLeadInvitationAction: vi.fn(), updateAssessorAvailabilityAction: vi.fn() }));
vi.mock("@/features/school/actions/leads", () => ({ recordLeadContactAction: vi.fn(), setLeadContactReminderAction: vi.fn(), assignLeadsAction: vi.fn(), confirmLeadIdentityAction: vi.fn(), getLeadIdentityOptionsAction: vi.fn() }));
vi.mock("@/features/school/actions/followups", () => ({ addStudentFollowUp: vi.fn() }));
vi.mock("@/features/school/communication-workday-actions", () => ({ completeCommunicationWorklistItemAction: vi.fn(), reviseCommunicationRecordAction: vi.fn() }));
vi.mock("@/features/school/enrollment-workflow-actions", () => ({ savePostActivityContactAction: vi.fn() }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => h("button", { type: "button" }, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("stage=awaiting_first_contact&page=4&pageSize=20") }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: ComponentProps<"a">) => h("a", props, children), useRouter: () => ({ replace: deps.replace, refresh: vi.fn() }), usePathname: () => "/dashboard/communication" }));

const at = "2026-09-23T00:00:00Z";
const students: StudentStageRow[] = Array.from({ length: 65 }, (_, index) => ({ key: `lead:${index}`, studentId: null, leadId: String(index), name: `Example ${index}`, phone: "", grade: index < 50 ? 3 : 4,
  gradeText: "", ownerId: index < 50 ? "owner-a" : "owner-b", ownerName: index < 50 ? "Support A" : "Support B", stage: "awaiting_first_contact", detail: "not_contacted", note: "", lastContactAt: null,
  nextContactAt: null, score: null, assessmentBand: null, assessmentAt: null, registrationId: null, courseTitle: "", termName: "", courseId: null, termId: null, createdAt: at, canWrite: true, canContact: true, invitation: null }));
const lead = (row: StudentStageRow): LeadPoolRow => ({ id: row.leadId!, provisionalStudentName: row.name, phone: "", gradeHint: row.grade, gradeText: "", status: "uncontacted", ownerId: row.ownerId, ownerName: row.ownerName,
  suggestedStudentId: null, suggestedStudentName: "", createdAt: at, acquiredAt: null, acquisitionLocation: "", acquisitionMethod: "", acquisitionPromoter: "", sourceCount: 1, sourceMarkedDuplicate: false,
  interests: [], contactCount: 0, lastContactAt: null, lastContactOutcome: null, lastContactNote: "", wechatAdded: null, visitCommitted: null, interestLevel: null, nextContactAt: null, activeInvitation: null });
const query = { version: 2 as const, filters: {}, sort: null };
const initial: FollowupServerFields = { query, facets: {}, facetsDeferred: true };
let root: Root, container: HTMLDivElement, actor: string;
let sequence = 0;
async function render(locale: "zh" | "en", fieldView = initial, rows = students.slice(0, 20), session = "first-page") {
  const props: ComponentProps<typeof InvitationCoordinationWorkbench> = { rows: [], activities: [], assessors: [], locale, currentUserId: actor, canManageInvitation: false,
    contactLeads: rows.map(lead), rowOrder: rows.map(row => row.key), firstContactOnly: true, firstContactRows: rows, fieldView, sessionKey: session };
  const children = h(CommunicationWorkSelectionProvider, { key: session, children: h(InvitationCoordinationWorkbench, props) });
  await act(async () => root.render(h(NextIntlClientProvider, { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", now: new Date(at), children })));
}
const click = async (node: HTMLElement | null) => { expect(node).toBeTruthy(); await act(async () => node!.click()); };
const option = (value: string) => document.querySelector<HTMLElement>(`[data-field-option="${value}"]`);
const open = (locale: "zh" | "en", column: "owner" | "grade" = "owner") => click(document.querySelector<HTMLElement>(`button[aria-label="${firstContactRowMessages(locale)[column]} · ${dashboardFieldMessages(locale).menu}"]`));
const escape = async () => {
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
const fullPage = (locale: string) => followupFieldPage(students, studentStageTableFields(locale, "awaiting_first_contact", actor), query, { locale, timeZone: "Asia/Shanghai", now: Date.parse(at) }, 1, 20);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  actor = `actor-${++sequence}`; vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => deps.facets(JSON.parse(String(init.body))) })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("embedded first contact filters", () => {
  it.each(["zh", "en"] as const)("loads off-page owners only on opening, filters the full list and resets pagination in %s", async locale => {
    const response = Promise.withResolvers<{ ok: true; data: FollowupServerFields["facets"] }>();
    deps.facets.mockReturnValue(response.promise);
    await render(locale);
    expect(deps.facets).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-communication-work-key]")).toHaveLength(20);
    await open(locale);
    expect(document.querySelector('[data-dashboard-field-menu]')?.textContent).toContain(dashboardFieldMessages(locale).optionsLoading);
    expect(deps.facets).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`/${locale}/dashboard/communication/filter-options`, expect.objectContaining({ method: "POST", cache: "no-store", credentials: "same-origin" }));
    await act(async () => response.resolve({ ok: true, data: fullPage(locale).fieldView.facets }));
    expect(option("owner-b")?.textContent).toContain("Support B");
    await click(option("owner-b"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 210)); });
    const url = new URL(deps.replace.mock.calls.at(-1)![0], "http://test.invalid");
    const selected = JSON.parse(url.searchParams.get("fields")!);
    expect(selected.filters.owner).toEqual({ kind: "enum", values: ["owner-b"] });
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.get("pageSize")).toBe("20");
    // 等服务端结果期间不再对当前 20 行执行本地筛选，避免闪成“没有数据”。
    expect(container.querySelectorAll("[data-communication-work-key]")).toHaveLength(20);
    const result = followupFieldPage(students, studentStageTableFields(locale, "awaiting_first_contact", actor), selected, { locale, timeZone: "Asia/Shanghai", now: Date.parse(at) }, 1, 20);
    expect(result.count).toBe(15);
    await escape();
    await render(locale, result.fieldView, result.rows, "filtered-page");
    expect(container.querySelectorAll("[data-communication-work-key]")).toHaveLength(15);
    await open(locale);
    expect(option("owner-a")).toBeTruthy();
    expect(option("owner-b")?.getAttribute("aria-checked")).toBe("true");
    expect(deps.facets).toHaveBeenCalledTimes(1);
  });

  it("reuses candidates across columns and pages, expires them, and isolates other accounts", async () => {
    deps.facets.mockImplementation(async () => ({ ok: true, data: fullPage("zh").fieldView.facets }));
    await render("zh"); await open("zh"); await escape(); await open("zh", "grade");
    expect(option("4")).toBeTruthy(); expect(deps.facets).toHaveBeenCalledTimes(1);
    await escape(); await render("zh", initial, students.slice(20, 40), "next-page"); await open("zh");
    expect(option("owner-b")).toBeTruthy(); expect(deps.facets).toHaveBeenCalledTimes(1);
    await escape();
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await open("zh"); expect(deps.facets).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks(); await escape(); actor = "another-account";
    await render("zh", initial, students.slice(0, 20), "other-user"); await open("zh");
    expect(deps.facets).toHaveBeenCalledTimes(3);
  });

  it("offers a retry on errors and reloads options for a different group", async () => {
    deps.facets.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN_SCOPE" }).mockImplementation(async () => ({ ok: true, data: fullPage("zh").fieldView.facets }));
    await render("zh"); await open("zh");
    expect(document.querySelector('[data-dashboard-field-menu]')?.textContent).toContain(dashboardFieldMessages("zh").optionsFailed);
    await click([...document.querySelectorAll<HTMLButtonElement>("[data-dashboard-field-menu] button")].find(node => node.textContent === "重试")!);
    expect(option("owner-b")).toBeTruthy(); expect(deps.facets).toHaveBeenCalledTimes(2);
    await escape();
    const groupQuery = { ...query, filters: { group: { kind: "enum" as const, values: ["group-b"] } } };
    await render("zh", { ...initial, query: groupQuery }, students.slice(0, 20), "different-group"); await open("zh");
    expect(deps.facets).toHaveBeenCalledTimes(3);
    expect(JSON.parse(deps.facets.mock.calls.at(-1)![0].fields)).toEqual(groupQuery);
  });
});
