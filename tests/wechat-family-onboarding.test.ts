import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ config: true, read: vi.fn(), issue: vi.fn(), phone: vi.fn(), owner: vi.fn(),
  rpc: vi.fn(), create: vi.fn(), getUser: vi.fn(), update: vi.fn(), password: vi.fn(), native: vi.fn(),
  context: vi.fn(), revoke: vi.fn(), authorize: vi.fn(), release: vi.fn(), active: vi.fn(), snapshot: vi.fn(), form: vi.fn() }));
vi.mock("@/features/wechat/miniapp-config", () => ({ getMiniappWechatConfig: () => h.config ? { phoneLinking: true, completionUrl: "https://example.test/auth/complete" } : null }));
vi.mock("@/features/wechat/miniapp-phone", async original => ({ ...await original<object>(), exchangeMiniappPhone: (...args: unknown[]) => h.phone(...args) }));
vi.mock("@/features/wechat/store", () => ({ readTicket: (...args: unknown[]) => h.read(...args), issueTicket: (...args: unknown[]) => h.issue(...args),
  findWechatUser: (...args: unknown[]) => h.owner(...args), assertAccountActive: (...args: unknown[]) => h.active(...args), saveWechatSnapshot: (...args: unknown[]) => h.snapshot(...args) }));
vi.mock("@/features/wechat/miniapp-session", () => ({ limitMiniappWechat: vi.fn(),
  createMiniappAuthClient: () => ({ auth: { signInWithPassword: h.password } }),
  exchangeMiniappIdentitySession: (...args: unknown[]) => h.native(...args),
  miniappSessionContext: (...args: unknown[]) => h.context(...args), revokeMiniappSession: (...args: unknown[]) => h.revoke(...args) }));
vi.mock("@/features/parent-portal/server", async original => ({ ...await original<object>(), authorize: (...args: unknown[]) => h.authorize(...args) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: h.rpc,
  auth: { admin: { createUser: h.create, getUserById: h.getUser, updateUserById: h.update } },
  from: (table: string) => {
    if (table === "miniapp_forms") {
      const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: h.form };
      return query;
    }
    if (table === "consent_policies") return { select: () => ({ eq: async () => ({ data: [
      { policy_kind: "privacy", version: "v1", document_path: "/privacy" },
      { policy_kind: "children_privacy", version: "v1", document_path: "/children" },
    ], error: null }) }) };
    return { update: (value: unknown) => { h.release(value); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } };
  },
}) }));
import { beginFamilyOnboarding, onboardingPost } from "@/features/parent-portal/onboarding-server";
import { onboardingCommandSchema } from "@/features/parent-portal/onboarding-contract";
import { verifiedPhone } from "@/features/wechat/miniapp-phone";
import { PortalError } from "@/features/parent-portal/server";
import { DEFAULT_FAMILY_FORM } from "../contracts/participant-api/onboarding";

const userId = "11111111-1111-4111-8111-111111111111", registrationId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333", ticket = "a".repeat(64);
const identity = { subject: "example:union", openid: "mini-open", unionid: "union", nickname: "", avatarUrl: null, authorizedAt: "2026-10-09T02:00:00.000Z" };
const proof = { purpose: "family-registration", identity, phone: "+8619900000001", localPhone: "19900000001", scene: null };
const family = { parentName: "Fixture parent", relation: "mother", childName: "Fixture child", gender: "", grade: 3,
  school: "", interests: ["math"], location: { status: "declined" }, privacyVersion: "v1", childrenPrivacyVersion: "v1", consent: true };
const reservation = { id: registrationId, userId, created: false, completed: false, family };
const request = (value: unknown) => new Request("https://example.test/api/v1/parent/auth/wechat/onboarding", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});
const complete = () => onboardingPost(request({ action: "complete", ticket, family }));
beforeEach(() => {
  vi.stubEnv("WECHAT_FAMILY_ONBOARDING_ENABLED", "true"); h.config = true;
  for (const value of Object.values(h)) if (typeof value === "function" && "mockReset" in value) value.mockReset();
  h.read.mockResolvedValue(proof); h.issue.mockResolvedValue("b".repeat(64)); h.phone.mockResolvedValue(proof);
  h.form.mockResolvedValue({ data: { ...DEFAULT_FAMILY_FORM, slug: "family-onboarding", version: 1 }, error: null });
  h.owner.mockResolvedValue(null); h.rpc.mockImplementation(async name => ({ error: null,
    data: name === "miniapp_prepare_family" ? reservation : { studentId, grade: 3 } }));
  h.create.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  h.getUser.mockResolvedValue({ data: { user: { id: userId, phone: "8619900000001", app_metadata: { miniapp_registration_id: registrationId }, identities: [], factors: [] } }, error: null });
  h.update.mockResolvedValue({ error: null });
  h.password.mockResolvedValue({ data: { user: { id: userId }, session: { access_token: "bootstrap", refresh_token: "bootstrap-refresh", expires_at: 1_900_000_000 } }, error: null });
  h.native.mockResolvedValue({ access_token: "native", refresh_token: "native-refresh", expires_at: 1_900_000_000 });
  h.context.mockImplementation(async (_config, token) => ({ sessionId: token, mfaRequired: false }));
});
afterEach(() => vi.unstubAllEnvs());

describe("verified family onboarding security", () => {
  it("rejects interest options not offered by this promotion before reserving an account", async () => {
    await expect(onboardingPost(request({ action: "complete", ticket, family: { ...family, interests: ["unknown"] } })))
      .rejects.toMatchObject({ code: "VALIDATION" });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  it("rejects a form changed after the phone proof was issued", async () => {
    h.read.mockResolvedValue({ ...proof, formVersion: 2 });
    await expect(complete()).rejects.toMatchObject({ code: "FORM_CHANGED" });
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("preserves the entry location bound to the server proof instead of replacing it at submission", async () => {
    const location = { status: "granted", latitude: 30, longitude: 120, accuracy: 20,
      enteredAt: "2026-10-09T02:00:00.000Z", capturedAt: "2026-10-09T02:00:01.000Z" };
    h.read.mockResolvedValue({ ...proof, location });
    await complete();
    expect(h.rpc).toHaveBeenCalledWith("miniapp_prepare_family", expect.objectContaining({ p_family: expect.objectContaining({ location }) }));
  });
  it("requires the configuration gate and a live server proof before phone exchange", async () => {
    h.config = false;
    await expect(onboardingPost(request({ action: "phone", ticket, code: "wx-code" }))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    h.config = true; h.read.mockResolvedValue(null);
    await expect(onboardingPost(request({ action: "phone", ticket, code: "wx-code" }))).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(h.phone).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  it("consumes the identity proof and returns masked phone plus a separate short-lived form proof", async () => {
    const result = await (await onboardingPost(request({ action: "phone", ticket, code: "wx-code" }))).json();
    expect(h.read).toHaveBeenCalledWith("guest", ticket, ticket, expect.anything(), true);
    expect(result).toMatchObject({ state: "family_required", ticket: "b".repeat(64), privacyVersion: "v1", childrenPrivacyVersion: "v1" });
    expect(JSON.stringify(result)).not.toContain(proof.phone); expect(JSON.stringify(result)).not.toContain(identity.subject);
    expect(h.issue).toHaveBeenCalledWith("guest", expect.objectContaining({ purpose: "family-registration", phone: proof.phone }), expect.any(String), expect.any(Number), expect.any(String));
  });
  it.each(["wechat", "phone"] as const)("keeps the %s handoff within the database lifetime limit when its clock lags", async step => {
    const applicationNow = Date.parse("2026-10-09T02:00:00.000Z");
    const databaseCreatedAt = applicationNow - 1500;
    h.issue.mockImplementation(async (_kind, _payload, _browser, seconds: number) => {
      const expiresAt = applicationNow + seconds * 1000;
      expect(expiresAt).toBeGreaterThan(databaseCreatedAt);
      expect(expiresAt).toBeLessThanOrEqual(databaseCreatedAt + 15 * 60 * 1000);
      return ticket;
    });
    if (step === "wechat") expect(await beginFamilyOnboarding(identity)).toMatchObject({ state: "onboarding_required", ticket });
    else expect(await (await onboardingPost(request({ action: "phone", ticket, code: "wx-code" }))).json())
      .toMatchObject({ state: "family_required", ticket });
    expect(h.issue).toHaveBeenCalledOnce();
  });
  it.each([{ phone: "+8619900000002" }, { openid: "another" }, { role: "teacher" }, { userId }])("rejects caller-supplied identity fields %j", extra => {
    expect(onboardingCommandSchema.safeParse({ action: "complete", ticket, family, ...extra }).success).toBe(false);
    expect(onboardingCommandSchema.safeParse({ action: "complete", ticket, family: { ...family, ...extra } }).success).toBe(false);
  });
  it("expired completion cannot create an Auth account", async () => {
    h.read.mockResolvedValue(null); await expect(complete()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(h.rpc).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  it("bootstraps only the reserved account, returns the native identity session and retires the temporary session", async () => {
    const result = await (await complete()).json();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ id: userId, phone: proof.phone, phone_confirm: true,
      app_metadata: { miniapp_registration_id: registrationId } }));
    expect(h.native).toHaveBeenCalledWith(expect.anything(), identity, userId, expect.objectContaining({ token: "bootstrap", sessionId: "bootstrap" }));
    expect(result).toEqual({ state: "authenticated", session: { accessToken: "native", refreshToken: "native-refresh", expiresAt: 1_900_000_000 }, participantId: studentId, grade: 3 });
    expect(h.revoke).toHaveBeenCalledWith("bootstrap", "native"); expect(h.release).toHaveBeenCalledWith({ lease_key: null, lease_until: null });
  });
  it.each(["completed", "email", "mfa", "identity", "differentPhone", "differentReservation"])("never resets an existing protected account (%s)", async reason => {
    h.rpc.mockResolvedValue({ data: { ...reservation, created: true, completed: reason === "completed" }, error: null });
    const protectedFields = { email: { email: "fixture@example.test" }, mfa: { factors: [{ status: "verified" }] },
      identity: { identities: [{ provider: "custom:wechat" }] }, differentPhone: { phone: "8619900000002" },
      differentReservation: { app_metadata: { miniapp_registration_id: "unrelated" } } };
    h.getUser.mockResolvedValue({ data: { user: { id: userId, phone: "8619900000001", app_metadata: { miniapp_registration_id: registrationId },
      ...(protectedFields[reason as keyof typeof protectedFields] ?? {}) } }, error: null });
    await expect(complete()).rejects.toMatchObject({ code: "ACCOUNT_SECURITY" });
    expect(h.update).not.toHaveBeenCalled(); expect(h.password).not.toHaveBeenCalled(); expect(h.native).not.toHaveBeenCalled();
  });
  it("conflicting identity cannot take the reserved phone account", async () => {
    h.owner.mockResolvedValue(studentId); await expect(complete()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.create).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
  it("an idempotent retry reuses the native identity without resetting a password", async () => {
    h.owner.mockResolvedValue(userId);
    expect((await (await complete()).json()).participantId).toBe(studentId);
    expect(h.create).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled(); expect(h.password).not.toHaveBeenCalled();
  });
  it("preserves a linked existing work account when completing its first household registration", async () => {
    h.rpc.mockImplementation(async name => ({ error: null,
      data: name === "miniapp_prepare_family" ? { ...reservation, created: true } : { studentId, grade: 3 } }));
    h.owner.mockResolvedValue(userId);
    expect((await (await complete()).json()).participantId).toBe(studentId);
    expect(h.native).toHaveBeenCalledWith(expect.anything(), identity, userId);
    expect(h.create).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
    expect(h.getUser).not.toHaveBeenCalled(); expect(h.password).not.toHaveBeenCalled();
  });
  it("a rejected final session revokes both issued sessions and releases the lease", async () => {
    h.authorize.mockRejectedValue(new PortalError("FORBIDDEN"));
    await expect(complete()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.revoke).toHaveBeenCalledWith("native"); expect(h.revoke).toHaveBeenCalledWith("bootstrap");
    expect(h.release).toHaveBeenCalled();
  });
  it("an MFA requirement stops family completion and revokes bootstrap credentials", async () => {
    h.context.mockResolvedValue({ sessionId: "bootstrap", mfaRequired: true });
    await expect(complete()).rejects.toMatchObject({ code: "ACCOUNT_SECURITY" });
    expect(h.native).not.toHaveBeenCalled(); expect(h.rpc).toHaveBeenCalledTimes(1); expect(h.revoke).toHaveBeenCalledWith("bootstrap");
  });
});

describe("official phone response validation", () => {
  const now = 1_800_000_000_000;
  const payload = { errcode: 0, phone_info: { phoneNumber: "19900000001", purePhoneNumber: "19900000001", countryCode: "86", watermark: { appid: "wx-fixture", timestamp: now / 1000 } } };
  it("normalizes a verified China phone to one family identifier", () => {
    expect(verifiedPhone(payload, "wx-fixture", now)).toMatchObject({ phone: proof.phone, localPhone: proof.localPhone });
  });
  it.each(["wrongApp", "expired", "future", "mismatch", "error"])("rejects invalid provider evidence (%s)", reason => {
    const value = structuredClone(payload);
    if (reason === "wrongApp") value.phone_info.watermark.appid = "other-app";
    if (reason === "expired") value.phone_info.watermark.timestamp -= 601;
    if (reason === "future") value.phone_info.watermark.timestamp += 61;
    if (reason === "mismatch") value.phone_info.phoneNumber = "19900000002";
    if (reason === "error") value.errcode = 40029;
    expect(() => verifiedPhone(value, "wx-fixture", now)).toThrow();
  });
});
