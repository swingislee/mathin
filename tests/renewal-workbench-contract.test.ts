import { describe, expect, it } from "vitest";
import { renewalDraftIsValid, renewalResult, renewalResultAllowsNextContact, renewalResultCanBeSelected,
  type RenewalWorkbenchDraft } from "../src/features/school/renewal-workbench-contract";

const draft: RenewalWorkbenchDraft = { result: "considering", contactMethod: "parent_meeting", seasons: ["winter", "spring"],
  note: "Parent feedback", nextContactAt: null, periodCount: "", paidAmount: "", paidOn: "", paymentMethod: null };
const payment = { opportunity_id: "opportunity", period_count: 2, paid_amount: 3200.5, note: "Paid offline" };
const paid: RenewalWorkbenchDraft = { ...draft, result: "paid", periodCount: "2", paidAmount: "3200.50", paidOn: "2026-09-01", paymentMethod: "wechat" };

describe("renewal worksheet facts", () => {
  it("distinguishes intentions, confirmed enrollment and actual payment", () => {
    expect(renewalResult("unprepared")).toBe("unprepared");
    expect(renewalResult("contacted")).toBe("considering");
    expect(renewalResult("committed")).toBe("payment_pending");
    expect(renewalResult("payment_pending")).toBe("payment_pending");
    expect(renewalResult("enrolled")).toBe("registered");
    expect(renewalResult("enrolled", payment)).toBe("paid");
    expect(renewalResult("not_enrolled")).toBe("not_enrolled");
  });
  it("preserves the enrolled/paid boundary and requires enrollment capability for either confirmation", () => {
    expect(renewalResultCanBeSelected("registered", "considering", false)).toBe(false);
    expect(renewalResultCanBeSelected("paid", "registered", true)).toBe(true);
    expect(renewalResultCanBeSelected("considering", "registered", true)).toBe(false);
    expect(renewalResultCanBeSelected("registered", "paid", true)).toBe(false);
    expect(renewalResultCanBeSelected("not_enrolled", "paid", true)).toBe(false);
    expect(renewalResultCanBeSelected("paid", "paid", true)).toBe(true);
  });
  it("keeps ordinary follow-up lightweight and requires real payment fields only for payment", () => {
    expect(renewalDraftIsValid(draft, false)).toBe(true);
    expect(renewalDraftIsValid({ ...draft, result: "registered" }, true)).toBe(true);
    expect(renewalDraftIsValid({ ...draft, result: "registered" }, false)).toBe(false);
    expect(renewalDraftIsValid(paid, true)).toBe(true);
    expect(renewalDraftIsValid(paid, false)).toBe(false);
    for (const patch of [{ periodCount: "" }, { periodCount: "0" }, { periodCount: "25" }, { periodCount: "1.5" },
      { paidAmount: "" }, { paidAmount: "0" }, { paidAmount: "1.001" }, { paidAmount: "1000000.01" }, { paidAmount: "Infinity" },
      { paidOn: "" }, { paidOn: "2026-02-30" }, { paidOn: "2026-99-99" }, { paymentMethod: null }]) {
      expect(renewalDraftIsValid({ ...paid, ...patch }, true)).toBe(false);
    }
    expect(renewalDraftIsValid({ ...paid, paidAmount: "1000000", periodCount: "24", paidOn: "2028-02-29" }, true)).toBe(true);
  });
  it("ends only this cycle's next contact for paid/not-renewing and retains it for unpaid enrollments", () => {
    expect(renewalResultAllowsNextContact("registered")).toBe(true);
    expect(renewalResultAllowsNextContact("nurturing")).toBe(true);
    expect(renewalResultAllowsNextContact("paid")).toBe(false);
    expect(renewalResultAllowsNextContact("not_enrolled")).toBe(false);
    expect(renewalDraftIsValid({ ...draft, nextContactAt: "not-a-date" }, true)).toBe(false);
    expect(renewalDraftIsValid({ ...draft, note: "x".repeat(2001) }, true)).toBe(false);
  });
});
