import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({
  claims: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), trusted: vi.fn(),
  active: true, sessionError: null as null | { message: string }, consent: true,
  account: { role: "admin", account_status: "active", password_change_required: false },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/features/wechat/trusted-session", () => ({ hasTrustedWechatSession: h.trusted }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getClaims: h.claims, getUser: h.getUser, signOut: h.signOut },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.account, error: null }) }) }) }),
  rpc: async (name: string) => name === "current_auth_session_active"
    ? { data: h.active, error: h.sessionError } : { data: h.consent, error: null },
}) }));
import { requireUser } from "@/lib/auth";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const claims = { sub: userId, session_id: sessionId, aal: "aal1", app_metadata: { providers: ["email", "custom:wechat"] } };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.mathin.club");
  vi.stubEnv("MATHIN_LOCAL_PRODUCTION_PREVIEW", "");
  vi.clearAllMocks(); h.active = true; h.sessionError = null; h.consent = true;
  h.account = { role: "admin", account_status: "active", password_change_required: false };
  h.claims.mockResolvedValue({ data: { claims }, error: null });
  h.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  h.trusted.mockResolvedValue(false);
});
afterEach(() => vi.unstubAllEnvs());

describe("administrator WeChat login gate", () => {
  it("lets the fixed local preview administrator enter at AAL1 without changing MFA factors", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:35421");
    vi.stubEnv("MATHIN_LOCAL_PRODUCTION_PREVIEW", "1");
    h.claims.mockResolvedValue({ data: { claims: {
      ...claims, app_metadata: { mathin_dev_mfa_exempt: true },
    } }, error: null });
    await expect(requireUser("zh")).resolves.toMatchObject({ id: userId, aal: "aal1" });
    expect(h.trusted).not.toHaveBeenCalled();
    h.account.account_status = "locked";
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/login");
  });

  it("still requires MFA when the preview switch points at a production database", async () => {
    vi.stubEnv("MATHIN_LOCAL_PRODUCTION_PREVIEW", "1");
    h.claims.mockResolvedValue({ data: { claims: {
      ...claims, app_metadata: { mathin_dev_mfa_exempt: true },
    } }, error: null });
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/dashboard/account-security?required=mfa");
  });

  it("accepts the current verified WeChat session without changing its native AAL", async () => {
    h.trusted.mockResolvedValue(true);
    await expect(requireUser("zh")).resolves.toMatchObject({ id: userId, aal: "aal1" });
    expect(h.trusted).toHaveBeenCalledWith(userId);
  });

  it("keeps MFA for password login even when the account already has a WeChat identity", async () => {
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/dashboard/account-security?required=mfa");
  });

  it("keeps native AAL2 sessions and account recovery available", async () => {
    h.claims.mockResolvedValue({ data: { claims: { ...claims, aal: "aal2" } }, error: null });
    await expect(requireUser("en")).resolves.toMatchObject({ aal: "aal2" });
    expect(h.trusted).not.toHaveBeenCalled();
    h.claims.mockResolvedValue({ data: { claims }, error: null });
    await expect(requireUser("zh", { allowAccountRecovery: true })).resolves.toMatchObject({ id: userId });
    expect(h.trusted).not.toHaveBeenCalled();
  });

  it("continues enforcing account locking before considering the WeChat proof", async () => {
    h.account.account_status = "locked"; h.trusted.mockResolvedValue(true);
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/login?error=locked");
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(h.trusted).not.toHaveBeenCalled();
  });

  it.each(["password", "consent"])("continues enforcing required %s", async (kind) => {
    if (kind === "password") h.account.password_change_required = true;
    if (kind === "consent") h.consent = false;
    h.trusted.mockResolvedValue(true);
    await expect(requireUser("zh")).rejects.toThrow(`REDIRECT:/zh/dashboard/account-security?required=${kind}`);
    expect(h.trusted).not.toHaveBeenCalled();
  });

  it("rejects revoked native sessions even when a WeChat cookie remains", async () => {
    h.active = false; h.trusted.mockResolvedValue(true);
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/login");
    expect(h.trusted).not.toHaveBeenCalled();
  });

  it("falls back to Auth when liveness RPC is unavailable and rejects ended sessions", async () => {
    h.sessionError = { message: "unavailable" };
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    h.trusted.mockResolvedValue(true);
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/login");
    expect(h.trusted).not.toHaveBeenCalled();
  });

  it("requires verified claims and does not impose admin MFA on other roles", async () => {
    h.claims.mockResolvedValueOnce({ data: null, error: new Error("invalid") });
    await expect(requireUser("zh")).rejects.toThrow("REDIRECT:/zh/login");
    h.account.role = "staff";
    await expect(requireUser("zh")).resolves.toMatchObject({ id: userId });
    expect(h.trusted).not.toHaveBeenCalled();
  });
});
