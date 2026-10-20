import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  receipt: null as null | { userId: string; identity: { subject: string }; flow: { mode: string; locale: string; next: string } },
  exchange: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), save: vi.fn(), session: vi.fn(), cookie: vi.fn(), remember: vi.fn(), active: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession: h.exchange, getUser: h.getUser, signOut: h.signOut } }) }));
vi.mock("@/features/wechat/broker", async () => {
  const { NextResponse } = await import("next/server");
  return { takeWechatCompletion: async () => h.receipt, privateRedirect: (url: URL | string) => NextResponse.redirect(url, { status: 303 }) };
});
vi.mock("@/features/wechat/store", () => ({ assertAccountActive: h.active, saveWechatSnapshot: (...args: unknown[]) => h.save(...args) }));
vi.mock("@/features/wechat/trusted-session", () => ({ rememberWechatSession: h.remember }));
vi.mock("@/features/wechat/session", () => ({ assertWechatFlowSession: (...args: unknown[]) => h.session(...args), setWechatCookie: (...args: unknown[]) => h.cookie(...args) }));
import { GET } from "@/app/[locale]/auth/callback/route";
const user = { id: "11111111-1111-4111-8111-111111111111", identities: [{ provider: "custom:wechat", identity_data: { sub: "mathin:union-user" } }] };
const call = (query: string) => GET(new Request(`https://app.example.com/zh/auth/callback?${query}`), { params: Promise.resolve({ locale: "zh" }) });
beforeEach(() => {
  h.receipt = null;
  h.exchange.mockReset().mockResolvedValue({ data: { user }, error: null }); h.getUser.mockReset().mockResolvedValue({ data: { user }, error: null });
  h.signOut.mockReset().mockResolvedValue({ error: null }); h.save.mockReset().mockResolvedValue(undefined);
  h.session.mockReset().mockResolvedValue(undefined); h.cookie.mockReset();
  h.remember.mockReset().mockResolvedValue(undefined); h.active.mockReset().mockResolvedValue(undefined);
});
function receipt() {
  h.receipt = { userId: user.id, identity: { subject: "mathin:union-user" }, flow: { mode: "link", locale: "zh", next: "/zh/dashboard" } };
}
describe("Supabase callback completion", () => {
  it("does not exchange a WeChat-marked callback without its browser receipt", async () => {
    const response = await call("code=application-code&wechat=1");
    expect(response.headers.get("location")).toContain("wechatError=failed");
    expect(h.exchange).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
  it("preserves existing email and password-recovery callbacks with safe redirect", async () => {
    expect((await call("code=application-code&next=/zh/dashboard/account-security?recovery=1")).headers.get("location"))
      .toBe("https://app.example.com/zh/dashboard/account-security?recovery=1");
    expect(h.save).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
  it("reports a failed code exchange rather than showing a success page", async () => {
    h.exchange.mockResolvedValue({ data: { user: null }, error: { message: "private provider error" } });
    expect((await call("code=expired-code")).headers.get("location")).toBe("https://app.example.com/zh/login?error=callback");
  });
  it("rejects account switching before exchanging the application code", async () => {
    receipt(); h.session.mockRejectedValue(new Error("expired"));
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toContain("wechatError=failed");
    expect(h.exchange).not.toHaveBeenCalled();
  });
  it("signs out an unexpected resulting user and never saves its profile", async () => {
    receipt(); h.getUser.mockResolvedValue({ data: { user: { ...user, id: "someone-else" } }, error: null });
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toContain("wechatError=failed");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" }); expect(h.save).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
  it("requires the exact linked subject, not merely any WeChat identity", async () => {
    receipt(); h.getUser.mockResolvedValue({ data: { user: { ...user, identities: [{ provider: "custom:wechat", identity_data: { sub: "another" } }] } }, error: null });
    await call("code=application-code&wechat=1");
    expect(h.signOut).toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
    expect(h.remember).not.toHaveBeenCalled();
  });
  it("confirms the original UUID and clears temporary credentials after linking", async () => {
    receipt();
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toBe("https://app.example.com/zh/dashboard/account-security?section=identities&wechatResult=linked");
    expect(h.save).toHaveBeenCalledWith(user.id, h.receipt?.identity);
    expect(h.remember).toHaveBeenCalledWith(user.id, h.receipt?.identity.subject);
    expect(h.cookie).toHaveBeenCalledWith("mathin_wechat_flow", "", 0);
    expect(h.cookie).toHaveBeenCalledWith("mathin_wechat_guest", "", 0);
  });
  it("records the verified login session before returning to the dashboard", async () => {
    receipt(); h.receipt!.flow.mode = "login";
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toBe("https://app.example.com/zh/dashboard");
    expect(h.remember).toHaveBeenCalledWith(user.id, "mathin:union-user");
    expect(h.remember.mock.invocationCallOrder[0]).toBeGreaterThan(h.save.mock.invocationCallOrder[0]);
  });
  it("revokes the new login when its server proof cannot be persisted", async () => {
    receipt(); h.receipt!.flow.mode = "login";
    h.remember.mockRejectedValueOnce(new Error("unavailable"));
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toContain("wechatError=failed");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it.each(["account", "binding"])("does not issue a trusted session after a failed %s check", async (kind) => {
    receipt();
    (kind === "account" ? h.active : h.save).mockRejectedValueOnce(new Error("failed"));
    expect((await call("code=application-code&wechat=1")).headers.get("location")).toContain("wechatError=failed");
    expect(h.remember).not.toHaveBeenCalled();
  });
});
