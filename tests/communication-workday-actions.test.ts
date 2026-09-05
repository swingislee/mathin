import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ rpc: vi.fn(), login: vi.fn(), get: vi.fn(), list: vi.fn(), refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: calls.refresh }));
vi.mock("../src/features/school/actions/guards", () => ({ staffRpcClient: calls.login }));
vi.mock("../src/features/school/communication-workday-data", () => ({
  communicationWorkdayRpc: calls.rpc, getCommunicationWorklist: calls.get, getCommunicationWorklists: calls.list,
}));
import { completeCommunicationWorklistItemAction, createCommunicationWorklistAction, getCommunicationWorklistsAction, reviseCommunicationRecordAction } from "../src/features/school/communication-workday-actions";

const id = "00000000-0000-4000-8000-000000000001";
const leadId = "00000000-0000-4000-8000-000000000002";
const worklist = { id, name: "My calls", date: "2026-09-05", ownerId: leadId, createdBy: leadId, createdAt: "2026-09-05T00:00:00Z", closedAt: null,
  items: [{ key: `lead:${leadId}`, position: 1, addedAt: "2026-09-05T00:00:00Z", completedAt: null }], rowKeys: [`lead:${leadId}`] };

describe("communication worklist and revision actions", () => {
  beforeEach(() => { vi.resetAllMocks(); calls.rpc.mockResolvedValue(id); calls.login.mockResolvedValue({}); calls.get.mockResolvedValue(worklist); calls.list.mockResolvedValue([worklist]); });

  it("validates a worklist and persists deduplicated keys in their requested order", async () => {
    expect(await createCommunicationWorklistAction({ name: " My calls ", date: "2026-09-05", keys: [`lead:${leadId}`, `lead:${leadId}`] })).toEqual({ ok: true, data: worklist });
    expect(calls.rpc).toHaveBeenCalledWith("create_communication_worklist", { p_name: "My calls", p_work_date: "2026-09-05", p_row_keys: [`lead:${leadId}`] });
    expect(calls.get).toHaveBeenCalledWith(id);
  });

  it("rejects invalid dates, keys, names and cross-source revision fields before reaching an RPC", async () => {
    for (const input of [{ name: "Calls", date: "2026-02-30", keys: [`lead:${leadId}`] }, { name: "Calls", date: "2026-09-05", keys: [leadId] }, { name: "x".repeat(101), date: "2026-09-05", keys: [`lead:${leadId}`] }]) {
      expect(await createCommunicationWorklistAction(input)).toEqual({ ok: false, code: "VALIDATION" });
    }
    // 外部调用即使绕过 TypeScript，也只能提交当前来源允许的更正字段。
    const invalidRevision = { source: "invitation", eventId: id, expectedRevision: null, patch: { outcome: "connected" } };
    expect(await reviseCommunicationRecordAction(invalidRevision as Parameters<typeof reviseCommunicationRecordAction>[0])).toEqual({ ok: false, code: "VALIDATION" });
    expect(await reviseCommunicationRecordAction({ source: "contact", eventId: id, expectedRevision: null, patch: {} })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await reviseCommunicationRecordAction({ source: "contact", eventId: id, expectedRevision: null, patch: { occurredAt: "2026-09-05T09:00" } })).toEqual({ ok: false, code: "VALIDATION" });
    expect(calls.rpc).not.toHaveBeenCalled();
    expect(calls.login).not.toHaveBeenCalled();
  });

  it("requires a verified login before write RPCs and preserves database scope errors", async () => {
    calls.login.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    expect(await completeCommunicationWorklistItemAction({ worklistId: id, key: `lead:${leadId}`, completed: true })).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(calls.rpc).not.toHaveBeenCalled();
    calls.rpc.mockRejectedValueOnce(new Error("FORBIDDEN_SCOPE"));
    expect(await completeCommunicationWorklistItemAction({ worklistId: id, key: `lead:${leadId}`, completed: true })).toEqual({ ok: false, code: "FORBIDDEN_SCOPE" });
  });

  it("completes or reopens a fixed item without replacing the worklist and lists worklists across dates", async () => {
    expect(await completeCommunicationWorklistItemAction({ worklistId: id, key: `lead:${leadId}`, completed: false })).toEqual({ ok: true, data: worklist });
    expect(calls.rpc).toHaveBeenCalledWith("complete_communication_worklist_item", { p_worklist_id: id, p_row_key: `lead:${leadId}`, p_completed: false });
    expect(await getCommunicationWorklistsAction()).toEqual({ ok: true, data: [worklist] });
    expect(calls.list).toHaveBeenCalledWith(undefined);
  });

  it("submits corrections to the revision RPC with expected version and leaves append-only contact actions untouched", async () => {
    const input = { source: "contact" as const, eventId: leadId, expectedRevision: null, patch: { occurredAt: "2026-09-04T23:00:00+08:00", note: "Corrected", outcome: "unreachable" as const, wechatAdded: false } };
    expect(await reviseCommunicationRecordAction(input)).toEqual({ ok: true, data: { revisionId: id } });
    expect(calls.rpc).toHaveBeenCalledExactlyOnceWith("revise_communication_record", { p_source: "contact", p_event_id: leadId, p_expected_revision: null,
      p_patch: { occurredAt: "2026-09-04T15:00:00.000Z", note: "Corrected", outcome: "unreachable", wechatAdded: false } });
    expect(calls.refresh).toHaveBeenCalled();
  });

  it.each(["REVISION_CONFLICT", "CORRECTION_REQUIRES_WORKFLOW"])("returns %s without refreshing stale UI data", async (code) => {
    calls.rpc.mockRejectedValueOnce(new Error(code));
    expect(await reviseCommunicationRecordAction({ source: "post_activity", eventId: id, expectedRevision: leadId, patch: { route: "closed" } })).toEqual({ ok: false, code });
    expect(calls.refresh).not.toHaveBeenCalled();
  });
});
