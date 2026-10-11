import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ config: true, rpc: vi.fn(), issue: vi.fn(), read: vi.fn(), exchange: vi.fn(),
  phone: vi.fn(), owner: vi.fn(), active: vi.fn(), getUser: vi.fn(), authorize: vi.fn(), establish: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc, auth: { admin: { getUserById: h.getUser } } }) }));
vi.mock("@/features/wechat/miniapp-config", () => ({ getMiniappWechatConfig: () => h.config ? { phoneLinking: true } : null }));
vi.mock("@/features/wechat/miniapp-provider", async original => ({ ...await original<object>(), exchangeMiniappWechatCode: (...args: unknown[]) => h.exchange(...args) }));
vi.mock("@/features/wechat/miniapp-phone", () => ({ exchangeMiniappPhone: (...args: unknown[]) => h.phone(...args) }));
vi.mock("@/features/wechat/miniapp-session", () => ({ limitMiniappWechat: (...args: unknown[]) => h.limit(...args) }));
vi.mock("@/features/wechat/store", () => ({ assertAccountActive: (...args: unknown[]) => h.active(...args),
  findWechatUser: (...args: unknown[]) => h.owner(...args), issueTicket: (...args: unknown[]) => h.issue(...args), readTicket: (...args: unknown[]) => h.read(...args) }));
vi.mock("@/features/parent-portal/server", async original => ({ ...await original<object>(), authorize: (...args: unknown[]) => h.authorize(...args) }));
vi.mock("@/features/parent-portal/onboarding-server", () => ({ familyOnboardingAvailable: () => h.config,
  verifiedAccountPhone: (user: { id: string; phone?: string; phone_confirmed_at?: string }) => user.phone_confirmed_at && user.phone
    ? { userId: user.id, phone: "+" + user.phone, localPhone: user.phone.slice(2) } : undefined,
  policies: async () => ({ privacyVersion: "v1", childrenPrivacyVersion: "v1", policyText: { zh: { privacy: "隐私", children: "儿童" }, en: { privacy: "Privacy", children: "Children" } } }),
  establishReservedMiniappAccount: (...args: unknown[]) => h.establish(...args),
}));
import { guardianBindingPost } from "@/features/parent-portal/guardian-binding-server";
import { guardianBindingCommand } from "@/features/parent-portal/guardian-binding-contract";
import { PortalError } from "@/features/parent-portal/server";

const invitation = "a".repeat(32), ticket = "b".repeat(64), uid = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222", intakeId = "33333333-3333-4333-8333-333333333333";
const identity = { subject: "fixture:guardian", openid: "fixture-open", unionid: "fixture-union", nickname: "", avatarUrl: null, authorizedAt: "2026-10-11T00:00:00Z" };
const phone = { phone: "+8619900000001", localPhone: "19900000001" };
const confirmation = { parentName: "Fixture parent", relation: "mother", consent: true, privacyVersion: "v1", childrenPrivacyVersion: "v1" };
const request = (body: unknown, authenticated = false) => new Request("https://example.test/api/v1/participant/guardian-binding", {
  method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer current" } : {}) }, body: JSON.stringify(body),
});
const confirm = (authenticated = false) => guardianBindingPost(request({ action: "confirm", ticket, confirmation }, authenticated));
beforeEach(() => {
  for (const value of Object.values(h)) if (typeof value === "function" && "mockReset" in value) value.mockReset();
  h.config = true;
  h.rpc.mockImplementation(async name => ({ error: null, data: name === "miniapp_guardian_preview"
    ? { maskedName: "测＊", expiresAt: "2026-10-18T00:00:00Z", name: "MUST_NOT_LEAK", studentId, school: "SECRET" }
    : name === "miniapp_prepare_guardian" ? { id: intakeId, userId: uid, created: false, completed: false }
      : { studentId, grade: 3, participantIds: [studentId] } }));
  h.issue.mockResolvedValue(ticket); h.exchange.mockResolvedValue(identity); h.owner.mockResolvedValue(null);
  h.read.mockResolvedValue({ purpose: "guardian-confirm", identity, invitation, ...phone });
  h.phone.mockResolvedValue(phone); h.authorize.mockResolvedValue({ user: { id: uid } });
  h.getUser.mockResolvedValue({ data: { user: { id: uid, phone: phone.phone.slice(1), phone_confirmed_at: "2026-10-10T00:00:00Z" } }, error: null });
  h.establish.mockImplementation(async (_config, _identity, _proof, _reservation, _lease, complete: () => Promise<unknown>) => ({ state: "authenticated", completed: await complete() }));
});

describe("explicit guardian association", () => {
  it("redacts preview even if the data source adds full profile fields", async () => {
    const result = await guardianBindingPost(request({ action: "preview", invitation }));
    expect(await result.json()).toEqual({ maskedName: "测＊", expiresAt: "2026-10-18T00:00:00Z" });
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(h.exchange).not.toHaveBeenCalled(); expect(h.phone).not.toHaveBeenCalled(); expect(h.establish).not.toHaveBeenCalled();
  });
  it("cannot start WeChat verification with an unavailable invitation", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(guardianBindingPost(request({ action: "login", invitation, code: "wx-code" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.exchange).not.toHaveBeenCalled(); expect(h.issue).not.toHaveBeenCalled();
  });
  it("WeChat verification prepares a short proof without reserving or binding an account", async () => {
    const result = await guardianBindingPost(request({ action: "login", invitation, code: "wx-code" }));
    expect(await result.json()).toEqual({ state: "phone_required", ticket });
    expect(h.issue).toHaveBeenCalledWith("guest", { purpose: "guardian-phone", identity, invitation }, expect.any(String), 840, expect.any(String));
    expect(h.rpc).toHaveBeenCalledTimes(1); expect(h.establish).not.toHaveBeenCalled();
  });
  it("uses a linked account's verified phone but still requires explicit confirmation", async () => {
    h.owner.mockResolvedValue(uid);
    const result = await guardianBindingPost(request({ action: "login", invitation, code: "wx-code" }));
    const data = await result.json();
    expect(data).toMatchObject({ state: "confirmation_required", ticket, maskedPhone: "+8619****0001" });
    expect(JSON.stringify(data)).not.toContain(phone.phone); expect(JSON.stringify(data)).not.toContain(identity.subject);
    expect(h.phone).not.toHaveBeenCalled(); expect(h.establish).not.toHaveBeenCalled();
  });
  it("phone authorization cannot consume the invitation or create a guardian relationship", async () => {
    h.read.mockResolvedValue({ purpose: "guardian-phone", identity, invitation });
    expect(await (await guardianBindingPost(request({ action: "phone", ticket, code: "phone-code" }))).json()).toMatchObject({ state: "confirmation_required" });
    expect(h.read).toHaveBeenCalledWith("guest", ticket, ticket, expect.anything(), true);
    expect(h.rpc.mock.calls.map(call => call[0])).toEqual(["miniapp_guardian_preview"]);
    expect(h.establish).not.toHaveBeenCalled();
  });
  it.each(["phone", "confirm"])("expired %s proof has no identity mutation", async action => {
    h.read.mockResolvedValue(null);
    await expect(guardianBindingPost(request(action === "phone" ? { action, ticket, code: "wx-code" } : { action, ticket, confirmation })))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.phone).not.toHaveBeenCalled(); expect(h.establish).not.toHaveBeenCalled();
  });
  it.each(["login", "confirm"])("refuses a current account that differs from the verified WeChat identity (%s)", async action => {
    h.owner.mockResolvedValue(studentId);
    await expect(guardianBindingPost(request(action === "login" ? { action, invitation, code: "wx-code" } : { action, ticket, confirmation }, true)))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.establish).not.toHaveBeenCalled();
    expect(h.rpc.mock.calls.some(call => call[0] === "miniapp_prepare_guardian")).toBe(false);
  });
  it.each([{ consent: false }, { studentId }, { phone: "+8619900000002" }, { scope: ["finance"] }, { role: "staff" }])("rejects forged or missing confirmation fields %j", extra => {
    expect(guardianBindingCommand.safeParse({ action: "confirm", ticket, confirmation: { ...confirmation, ...extra } }).success).toBe(false);
  });
  it("only explicit confirmation reserves the exact server-proved identity and existing invitation", async () => {
    const result = await confirm();
    expect(await result.json()).toMatchObject({ state: "authenticated", completed: { studentId } });
    expect(h.rpc).toHaveBeenNthCalledWith(1, "miniapp_prepare_guardian", expect.objectContaining({ p_code: invitation, p_subject: identity.subject,
      p_phone: phone.phone, p_local_phone: phone.localPhone, p_answers: confirmation }));
    expect(h.rpc).toHaveBeenNthCalledWith(2, "miniapp_complete_guardian", expect.objectContaining({ p_id: intakeId, p_subject: identity.subject }));
    expect(h.read).toHaveBeenCalledWith("guest", ticket, ticket, expect.anything());
    expect(h.rpc.mock.calls.some(call => String(call[0]).includes("family"))).toBe(false);
  });
  it("an invalid or revoked reservation never bootstraps an Auth account", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "NOT_FOUND" } });
    await expect(confirm()).rejects.toBeInstanceOf(PortalError); expect(h.establish).not.toHaveBeenCalled();
  });
});
