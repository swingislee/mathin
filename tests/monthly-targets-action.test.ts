import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/school/actions/guards", () => ({ authorizedClient: mocks.authorize, nullableRpcArg: (value: unknown) => value ?? undefined }));
import { saveMonthlyTargetsAction } from "@/features/school/actions/monthly-targets";

const valid = { month: "2026-09", revision: 1, cells: [{ teacher: "甲", grade: "1年级", target: 5 }], arrivalTarget: 174, invitationTarget: 217 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});

describe("monthly target action boundary", () => {
  it("rejects malformed dates and counts before requesting a write", async () => {
    for (const input of [{ ...valid, month: "2026-13" }, { ...valid, cells: [{ ...valid.cells[0], target: -1 }] }, { ...valid, revision: 0 }]) {
      expect(await saveMonthlyTargetsAction(input)).toEqual({ ok: false, code: "VALIDATION" });
    }
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires organization management permission and propagates a stale version", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "VERSION_CONFLICT" } });
    expect(await saveMonthlyTargetsAction(valid)).toEqual({ ok: false, code: "VERSION_CONFLICT" });
    expect(mocks.authorize).toHaveBeenCalledWith("organization.settings.manage");
    expect(mocks.rpc).toHaveBeenCalledWith("save_school_monthly_targets", {
      p_month: "2026-09-01", p_revision: 1, p_targets: valid.cells, p_arrival_target: 174, p_invitation_target: 217,
    });
  });

  it("does not call the write RPC after permission is denied", async () => {
    mocks.authorize.mockRejectedValue(new Error("FORBIDDEN"));
    expect(await saveMonthlyTargetsAction(valid)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
