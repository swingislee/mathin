// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { LeadContactEntryRow } from "@/features/school/LeadFirstContactWorkbench";
import type { LeadPoolRow } from "@/features/school/lead-contract";

const actions = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/school/actions/leads", () => ({ recordLeadContactAction: actions.record, setLeadContactReminderAction: vi.fn(),
  assignLeadsAction: vi.fn(), confirmLeadIdentityAction: vi.fn(), getLeadIdentityOptionsAction: vi.fn() }));
vi.mock("@/features/school/actions/followups", () => ({ addStudentFollowUp: vi.fn() }));
vi.mock("@/features/school/actions/invitations", () => ({ updateLeadInvitationAction: vi.fn(), updateAssessorAvailabilityAction: vi.fn() }));
vi.mock("@/features/school/Student360Sheet", () => ({ Student360Trigger: ({ children }: { children: ReactNode }) => createElement("button", { type: "button" }, children) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/dashboard/followups/communication" }));

const lead: LeadPoolRow = {
  id: "lead", provisionalStudentName: "示例学生", phone: "13800000000", gradeHint: 3, gradeText: "3年级", status: "uncontacted",
  ownerId: "owner", ownerName: "学服老师", suggestedStudentId: null, suggestedStudentName: "", createdAt: "2026-09-08T01:00:00Z",
  acquiredAt: null, acquisitionLocation: "", acquisitionMethod: "", acquisitionPromoter: "", sourceCount: 1, sourceMarkedDuplicate: false,
  interests: [], contactCount: 0, lastContactAt: null, lastContactOutcome: null, lastContactNote: "上次保留的资料",
  wechatAdded: null, visitCommitted: null, interestLevel: null, nextContactAt: null, activeInvitation: null,
};

describe("compact first-contact registration", () => {
  it.each(["zh", "en"] as const)("keeps the draft through collapse and saves the chosen result only on explicit submission in %s", async locale => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    actions.record.mockReset().mockResolvedValue({ ok: true });
    const saved = vi.fn();
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    const messages = locale === "zh" ? zh : en;
    const row = createElement(LeadContactEntryRow, { lead, locale, active: false, layout: "communication", activities: [], assessors: [], canContact: true,
      formatAt: value => value, onActivate: vi.fn(), onSaved: saved, onReminderSaved: vi.fn() });
    const provider: ComponentProps<typeof NextIntlClientProvider> = { locale, messages, timeZone: "Asia/Shanghai", children: createElement("table", null, createElement("tbody", null, row)) };
    const click = async (node: HTMLElement) => { expect(node).toBeTruthy(); await act(async () => node.click()); };
    const summary = () => container.querySelector<HTMLTableRowElement>('[data-first-contact-record="lead:lead"]')!;
    const toggle = () => summary().querySelector<HTMLButtonElement>('button[aria-controls="lead-contact-details-lead"]')!;
    try {
      await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
      expect(summary().querySelector("input,textarea,[role=combobox]")).toBeNull();
      await click(toggle());
      const detail = container.querySelector<HTMLTableRowElement>("[data-followup-inline-details]")!;
      expect(detail.querySelector(`[role="combobox"][aria-label="${messages.school.followupEntry.outcome}"]`)).toBeTruthy();
      await act(async () => detail.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })));
      const draft = container.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(draft, "明天继续联系，保留草稿");
        draft.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(actions.record).not.toHaveBeenCalled();
      await click(toggle());
      expect(container.querySelector("textarea")).toBeNull();
      expect(summary().textContent).toContain(lead.lastContactNote);
      expect(summary().querySelector("[data-first-contact-status-tags]")?.textContent).not.toContain(messages.school.leads.contactOutcome_unreachable);
      expect(summary().querySelector(`[aria-label="${messages.school.followupEntry.unsaved}"]`)).toBeTruthy();
      await click(toggle());
      expect(container.querySelector("textarea")?.value).toBe("明天继续联系，保留草稿");
      expect(container.querySelector('[data-followup-business] [role="combobox"]')?.textContent).toContain(messages.school.leads.contactOutcome_unreachable);
      await click(container.querySelector<HTMLButtonElement>('[data-followup-entry-actions] [aria-keyshortcuts="Control+Enter Meta+Enter"]')!);
      expect(actions.record).toHaveBeenCalledExactlyOnceWith("lead", { outcome: "unreachable", note: "明天继续联系，保留草稿",
        wechatAdded: null, interestLevel: null, invitation: null, nextContactAt: null });
      expect(saved).toHaveBeenCalledWith("lead", expect.objectContaining({ outcome: "unreachable", note: "明天继续联系，保留草稿" }), false);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
