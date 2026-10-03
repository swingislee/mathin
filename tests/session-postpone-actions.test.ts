import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }));
vi.mock("@/features/school/actions/guards", () => ({ staffRpcClient: mocks.client }));
import { applySessionPostponeAction, previewSessionPostponeAction } from "@/features/school/actions/session-postpone";

const id = "00000000-0000-0000-0000-000000000001";
const token = "a".repeat(32);
const input = { sessionId: id, days: 7 };
const apply = { ...input, expectedToken: token, confirmClosedDays: false, closedDayReason: "" };
const preview = {
  token, classroomId: id, sessionId: id, days: 7, timeZone: "Asia/Shanghai", skippedCount: 2,
  sessions: [{ id, title: "Lesson", no: 1, previousScheduledAt: "2026-10-03T01:00:00Z", scheduledAt: "2026-10-10T01:00:00Z", durationMin: 90, roomId: null, closedDayId: null, closedDayName: null }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ supabase: { rpc: mocks.rpc } });
});

describe("session postponement action boundaries", () => {
  it.each([0, -7, 1.5, 366, NaN, Infinity])("rejects invalid day count %s before reading or writing", async days => {
    expect(await previewSessionPostponeAction({ ...input, days })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await applySessionPostponeAction({ ...apply, days })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("requires the session ID and the matching preview token", async () => {
    expect(await previewSessionPostponeAction({ ...input, sessionId: "bad" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await applySessionPostponeAction({ ...apply, expectedToken: "" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves the server-calculated scope, timezone, dates and skipped count", async () => {
    mocks.rpc.mockResolvedValue({ data: preview, error: null });
    expect(await previewSessionPostponeAction(input)).toEqual({ ok: true, data: { ...preview, sessions: [
      { ...preview.sessions[0], previousScheduledAt: "2026-10-03T01:00:00.000Z", scheduledAt: "2026-10-10T01:00:00.000Z" },
    ] } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("preview_session_schedule_postpone", { p_session_id: id, p_days: 7 });
  });
  it.each(["FORBIDDEN_SCOPE", "SESSION_ALREADY_STARTED", "CLASSROOM_NOT_ACTIVE", "SCHEDULE_PREVIEW_STALE", "CLOSED_DAY_CONFIRMATION_REQUIRED"])("returns %s without a fallback write", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code } });
    expect(await applySessionPostponeAction(apply)).toEqual({ ok: false, code });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("sends one atomic write with the exact preview token and closed-day confirmation", async () => {
    mocks.rpc.mockResolvedValue({ data: { updatedCount: 4 }, error: null });
    expect(await applySessionPostponeAction({ ...apply, confirmClosedDays: true, closedDayReason: " Make-up class " })).toEqual({ ok: true, data: { updatedCount: 4 } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("apply_session_schedule_postpone", {
      p_session_id: id, p_days: 7, p_expected_token: token, p_confirm_closed_days: true, p_closed_day_reason: "Make-up class",
    });
  });
  it("does not report success for an empty or malformed response", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...preview, sessions: [] }, error: null });
    expect((await previewSessionPostponeAction(input)).ok).toBe(false);
    mocks.rpc.mockResolvedValue({ data: { updatedCount: 0 }, error: null });
    expect((await applySessionPostponeAction(apply)).ok).toBe(false);
  });
});
