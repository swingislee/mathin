import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultTaskSubmissionRules } from "../contracts/participant-api/task-submission";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ rpc: vi.fn(), adminRpc: vi.fn(), storage: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://example.test", key: "test-public-key" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }) }, rpc: h.rpc,
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { is_active: true, account_status: "active", password_change_required: false }, error: null }) }; return q; },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.adminRpc, storage: { from: h.storage } }) }));
import { mediaPost } from "@/features/parent-portal/server";
let rules = defaultTaskSubmissionRules();
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-only-rate-limit-key"); rules = defaultTaskSubmissionRules();
  h.rpc.mockImplementation(async name => ({ data: name === "miniapp_task_submission_rules" ? rules : true, error: null }));
  h.adminRpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());
function request() {
  const bytes = new Uint8Array(300); bytes.set([137,80,78,71,13,10,26,10]);
  const body = new FormData(); body.set("file", new File([bytes], "pretend-video.mp4", { type: "video/mp4" }));
  return new Request("https://example.test/api/v1/parent/media", { method: "POST", body, headers: { authorization: "Bearer fixture-only-token",
    "x-assignment-id": "22222222-2222-4222-8222-222222222222", "x-participant-id": "33333333-3333-4333-8333-333333333333" } });
}
describe("assignment requirements before media storage", () => {
  it("rejects uploads for text-only assignments before reading the body", async () => {
    rules = { ...rules, mediaTypes: [], minFiles: 0, maxFiles: 0, noteRequired: true };
    const req = request(); await expect(mediaPost(req)).rejects.toMatchObject({ code: "FILE_TYPE" });
    expect(req.bodyUsed).toBe(false); expect(h.adminRpc).not.toHaveBeenCalled(); expect(h.storage).not.toHaveBeenCalled();
  });
  it("uses file bytes instead of a claimed MIME type when enforcing allowed media", async () => {
    rules = { ...rules, mediaTypes: ["video"] };
    await expect(mediaPost(request())).rejects.toMatchObject({ code: "FILE_TYPE" });
    expect(h.storage).not.toHaveBeenCalled(); expect(h.rpc.mock.calls.some(([name]) => name === "miniapp_reserve_upload")).toBe(false);
  });
  it("rejects assignment-specific sizes before reserving or storing media", async () => {
    rules = { ...rules, imageMaxBytes: 128 };
    await expect(mediaPost(request())).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(h.storage).not.toHaveBeenCalled(); expect(h.rpc.mock.calls.some(([name]) => name === "miniapp_reserve_upload")).toBe(false);
  });
  it("checks participant and assignment access before processing the upload", async () => {
    h.rpc.mockImplementation(async name => name === "miniapp_task_submission_rules" ? { data: null, error: { message: "FORBIDDEN" } } : { data: true, error: null });
    const req = request(); await expect(mediaPost(req)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(req.bodyUsed).toBe(false); expect(h.storage).not.toHaveBeenCalled();
  });
});
