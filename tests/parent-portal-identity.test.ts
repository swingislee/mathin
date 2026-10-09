import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ user: vi.fn(), profile: vi.fn(), upload: vi.fn(), rpc: vi.fn(), sign: vi.fn(), completed: vi.fn() }));
const query = (result: typeof h.profile) => {
  const chain = { select: () => chain, eq: () => chain, not: () => chain, limit: () => chain, maybeSingle: result };
  return chain;
};
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: () => ({ url: "https://example.test", key: "fixture" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: h.user }, rpc: h.rpc,
  from: (name: string) => query(name === "profiles" ? h.profile : h.upload),
  storage: { from: () => ({ createSignedUrl: h.sign }) },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query(h.completed) }) }));
import { authorize, mediaGet } from "@/features/parent-portal/server";
import { needsFamilyOnboarding } from "@/features/parent-portal/onboarding-server";
const userId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const request = () => new Request(`https://example.test/api/v1/parent/media?id=${studentId}`, { headers: { authorization: "Bearer fixture" } });
const profile = { display_name: "Fixture", role: "admin", is_active: true, account_status: "active", password_change_required: false };
beforeEach(() => {
  vi.resetAllMocks(); h.user.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  h.profile.mockResolvedValue({ data: profile, error: null }); h.rpc.mockResolvedValue({ data: true, error: null });
  h.upload.mockResolvedValue({ data: { object_path: "fixture/item", student_id: studentId, kind: "image" }, error: null });
  const signed = new URL("https://example.test/object"); signed.searchParams.set("token", "fixture-signature");
  h.sign.mockResolvedValue({ data: { signedUrl: signed.href }, error: null });
  h.completed.mockResolvedValue({ data: null, error: null });
});
describe("participant access for work accounts", () => {
  it.each(["admin", "teacher", "parent", "student"])("accepts an active %s account without rewriting its role", async role => {
    h.profile.mockResolvedValue({ data: { ...profile, role }, error: null });
    expect((await authorize(request())).profile.role).toBe(role);
  });
  it.each([{ is_active: false }, { account_status: "suspended" }, { password_change_required: true }])("keeps account-state checks %j", async fields => {
    h.profile.mockResolvedValue({ data: { ...profile, ...fields }, error: null });
    await expect(authorize(request())).rejects.toMatchObject({ code: "ACCOUNT_SECURITY" });
  });
  it("requires current consents for every role", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });
    await expect(authorize(request())).rejects.toMatchObject({ code: "ACCOUNT_SECURITY" });
  });
  it("does not sign unrelated student media even when staff RLS can read the row", async () => {
    h.rpc.mockImplementation(async name => ({ data: name !== "miniapp_can_participate", error: null }));
    await expect(mediaGet(request())).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.sign).not.toHaveBeenCalled();
  });
  it("requires the separate video scope before signing family video", async () => {
    h.upload.mockResolvedValue({ data: { object_path: "fixture/item", student_id: studentId, kind: "video" }, error: null });
    h.rpc.mockImplementation(async (_name, args) => ({ data: args?.p_scope !== "video", error: null }));
    await expect(mediaGet(request())).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.sign).not.toHaveBeenCalled();
  });
  it("signs a related participant's authorized attachment", async () => {
    expect((await mediaGet(request())).status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("miniapp_can_participate", { p_student: studentId, p_scope: "grades" });
  });
  it("registers an empty household once and keeps existing self or child associations", async () => {
    const { db } = await authorize(request()); h.rpc.mockResolvedValue({ data: [], error: null });
    expect(await needsFamilyOnboarding(db, userId)).toBe(true);
    h.completed.mockResolvedValue({ data: { id: studentId }, error: null });
    expect(await needsFamilyOnboarding(db, userId)).toBe(false);
    h.completed.mockClear(); h.rpc.mockResolvedValue({ data: [{ id: studentId }], error: null });
    expect(await needsFamilyOnboarding(db, userId)).toBe(false); expect(h.completed).not.toHaveBeenCalled();
  });
});
