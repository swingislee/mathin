import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", phone: "", identities: [] as Array<{ provider: string }> },
  active: true, phoneLinking: false, authFailure: false,
  requireUser: vi.fn(), password: vi.fn(), begin: vi.fn(), unlink: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { h.requireUser(); if (h.authFailure) throw new Error("auth-required"); return h.user; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { unlinkIdentity: h.unlink, signOut: vi.fn() } }) }));
vi.mock("@/features/wechat/config", () => ({ requireWechatConfig: () => ({ phoneLinking: h.phoneLinking }) }));
vi.mock("@/features/wechat/session", () => ({
  beginWechatFlow: (...args: unknown[]) => h.begin(...args),
  currentWechatAuthContext: async () => ({ userId: h.user.id, sessionId: "22222222-2222-4222-8222-222222222222", user: h.user }),
  verifyWechatLinkPassword: (...args: unknown[]) => h.password(...args), setWechatCookie: vi.fn(),
}));
vi.mock("@/features/wechat/store", () => ({ assertAccountActive: async () => { if (!h.active) throw new Error("failed"); }, readGuest: vi.fn() }));
import { bindWechat, unlinkWechat } from "@/features/wechat/actions";
function input(confirm = true) {
  const form = new FormData(); form.set("locale", "zh"); form.set("password", "test-only-capability");
  if (confirm) form.set("confirm", "on"); return form;
}
beforeEach(() => {
  h.active = true; h.phoneLinking = false; h.authFailure = false;
  h.user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", phone: "", identities: [{ provider: "email" }] };
  h.password.mockReset().mockResolvedValue(undefined); h.begin.mockReset().mockResolvedValue("https://app.example.com/authorize");
  h.unlink.mockReset().mockResolvedValue({ error: null }); h.requireUser.mockReset();
});
describe("WeChat account ownership", () => {
  it("requires original password, explicit consent and a verified current user", async () => {
    await expect(bindWechat(input(false))).rejects.toThrow("wechatError=credentials");
    expect(h.password).not.toHaveBeenCalled();
    await expect(bindWechat(input())).rejects.toThrow("redirect:https://app.example.com/authorize");
    expect(h.password).toHaveBeenCalledWith(h.user.id, { email: h.user.email }, "test-only-capability");
    expect(h.begin).toHaveBeenCalledWith(expect.objectContaining({ mode: "link", userId: h.user.id }));
  });
  it("does not proceed if the established lock, consent, initial-password or MFA gate redirects", async () => {
    h.authFailure = true;
    await expect(bindWechat(input())).rejects.toThrow("auth-required");
    expect(h.password).not.toHaveBeenCalled(); expect(h.begin).not.toHaveBeenCalled();
  });
  it("does not start linking after incorrect password or insufficient MFA", async () => {
    h.password.mockRejectedValue(new Error("credentials"));
    await expect(bindWechat(input())).rejects.toThrow("wechatError=credentials");
    expect(h.begin).not.toHaveBeenCalled();
  });
  it("gates phone-only accounts on the verified Auth fix and preserves the real phone", async () => {
    h.user.email = ""; h.user.phone = "+8613800000000"; h.user.identities = [{ provider: "phone" }];
    await expect(bindWechat(input())).rejects.toThrow("wechatError=phoneCompatibility");
    expect(h.begin).not.toHaveBeenCalled();
    h.phoneLinking = true;
    await expect(bindWechat(input())).rejects.toThrow("redirect:https://app.example.com/authorize");
    expect(h.password).toHaveBeenCalledWith(h.user.id, { phone: h.user.phone }, "test-only-capability");
  });
  it("keeps the last identity and requires a usable password method before unlinking", async () => {
    h.user.email = ""; h.user.identities = [{ provider: "custom:wechat" }];
    await expect(unlinkWechat(input())).rejects.toThrow("wechatError=credentials");
    expect(h.unlink).not.toHaveBeenCalled();
  });
  it("uses the native unlink API after checking original account ownership", async () => {
    const identity = { provider: "custom:wechat" };
    h.user.identities.push(identity);
    await expect(unlinkWechat(input())).rejects.toThrow("wechatResult=unlinked");
    expect(h.unlink).toHaveBeenCalledWith(identity);
  });
});
