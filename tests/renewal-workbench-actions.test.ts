import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn(), refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: calls.refresh }));
vi.mock("../src/features/school/actions/guards", () => ({ authorizedClient: calls.authorize }));
import { saveRenewalWorkbenchAction } from "../src/features/school/renewal-workbench-actions";

const id = "00000000-0000-4000-8000-000000000001";
const input: Parameters<typeof saveRenewalWorkbenchAction>[0] = { cycleId: id, membershipId: id, expectedRevision: 0,
  result: "considering", note: " Parent feedback ", contactMethod: "parent_meeting", seasons: ["winter", "spring"],
  nextContactAt: "2026-09-09T14:30:00+08:00", periodCount: null, paidAmount: null, paidOn: null, paymentMethod: null };

describe("renewal workbench action", () => {
  beforeEach(() => { vi.resetAllMocks(); calls.authorize.mockResolvedValue({ supabase: { rpc: calls.rpc } }); calls.rpc.mockResolvedValue({ data: { saved: true }, error: null }); });
  it("validates and sends the complete versioned draft in a single RPC", async () => {
    expect(await saveRenewalWorkbenchAction(input)).toEqual({ ok: true, data: { saved: true } });
    expect(calls.authorize).toHaveBeenCalledWith("followup.write");
    expect(calls.rpc).toHaveBeenCalledExactlyOnceWith("save_renewal_workbench_v1", {
      p_cycle_id: id, p_membership_id: id, p_expected_revision: 0, p_result: "considering", p_note: "Parent feedback",
      p_contact_method: "parent_meeting", p_seasons: ["winter", "spring"], p_next_contact_at: "2026-09-09T06:30:00.000Z",
      p_period_count: null, p_paid_amount: null, p_paid_on: null, p_payment_method: null,
    });
    expect(calls.refresh).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed dates, duplicate seasons, unsaved payment prerequisites and unexpected payment data before authorization", async () => {
    const invalid = [{ paidAmount: 100 }, { expectedRevision: -1 }, { seasons: ["spring", "spring"] },
      { result: "paid" }, { result: "paid", periodCount: 2, paidAmount: 3000, paidOn: "2026-02-30", paymentMethod: "wechat" },
      { result: "paid", periodCount: 2, paidAmount: 0, paidOn: "2026-09-01", paymentMethod: "wechat" },
      { result: "paid", periodCount: 2, paidAmount: 10.005, paidOn: "2026-09-01", paymentMethod: "wechat" },
      { nextContactAt: "never" }, { note: "x".repeat(2001) }];
    for (const patch of invalid) expect(await saveRenewalWorkbenchAction({ ...input, ...patch } as typeof input)).toEqual({ ok: false, code: "VALIDATION" });
    expect(calls.authorize).not.toHaveBeenCalled(); expect(calls.rpc).not.toHaveBeenCalled();
  });
  it("accepts a leap-day payment and leaves registered-without-payment distinct", async () => {
    expect((await saveRenewalWorkbenchAction({ ...input, result: "paid", periodCount: 2, paidAmount: 3200.5, paidOn: "2028-02-29", paymentMethod: "mofaxiao_qr" })).ok).toBe(true);
    expect((await saveRenewalWorkbenchAction({ ...input, result: "registered" })).ok).toBe(true);
  });
  it.each(["RENEWAL_WORKBENCH_CONFLICT", "FORBIDDEN_SCOPE", "FORBIDDEN", "OPPORTUNITY_ENROLLED", "INVALID_CYCLE_STATE"])("returns %s without refreshing after a failed save", async code => {
    calls.rpc.mockResolvedValue({ data: null, error: { message: code } });
    expect(await saveRenewalWorkbenchAction(input)).toEqual({ ok: false, code });
    expect(calls.refresh).not.toHaveBeenCalled();
  });
  it("does not call the RPC when authentication fails", async () => {
    calls.authorize.mockRejectedValue(new Error("UNAUTHENTICATED"));
    expect(await saveRenewalWorkbenchAction(input)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(calls.rpc).not.toHaveBeenCalled();
  });
});
