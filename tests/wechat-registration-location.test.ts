import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegistrationLocation } from "../contracts/participant-api/onboarding";
import { DEFAULT_FAMILY_FORM } from "../contracts/participant-api/onboarding";
import type { FamilyRegistration, PhoneResult } from "../apps/parent-wechat/miniprogram/lib/onboarding";

type LocationApi = { registrationLocation: () => Promise<RegistrationLocation> };
function runtime(overrides: Record<string, unknown> = {}) {
  const wx = { getSetting: vi.fn(async () => ({ authSetting: { "scope.userLocation": true } })),
    requirePrivacyAuthorize: vi.fn(async () => undefined), getLocation: vi.fn(async () => ({ latitude: 30, longitude: 120, accuracy: 8 })), ...overrides };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("apps/parent-wechat/miniprogram/lib/registration-location.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText,
  { exports, wx, Date, setTimeout, clearTimeout });
  return { api: exports as LocationApi, wx };
}
afterEach(() => vi.useRealTimers());
describe("single location request at submission", () => {
  it("captures only when requested and records the capture time", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T02:00:00.000Z"));
    const run = runtime();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-10-09T02:10:00.000Z"));
    const captured = await run.api.registrationLocation();
    expect(captured).toMatchObject({ status: "granted", capturedAt: "2026-10-09T02:10:00.000Z" });
    expect(captured).not.toHaveProperty("enteredAt");
    expect(run.wx.getLocation).toHaveBeenCalledTimes(1);
  });
  it("honors a previously declined permission without prompting again", async () => {
    const run = runtime({ getSetting: async () => ({ authSetting: { "scope.userLocation": false } }) });
    expect(await run.api.registrationLocation()).toMatchObject({ status: "declined" });
    expect(run.wx.getLocation).not.toHaveBeenCalled(); expect(run.wx.requirePrivacyAuthorize).not.toHaveBeenCalled();
  });
  it("does not keep waiting or locate after a long authorization delay", async () => {
    vi.useFakeTimers(); let authorize!: () => void;
    const run = runtime({ requirePrivacyAuthorize: () => new Promise<void>(resolve => { authorize = resolve; }) });
    const result = run.api.registrationLocation();
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject({ status: "unavailable" });
    authorize(); await Promise.resolve();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
  });
});

type OnboardingPage = {
  data: { busy: boolean; consent: boolean; policy: PhoneResult | null; ticket: string;
    values: { parentName: string; childName: string; school: string }; selection: { relation: number; gender: number; grade: number }; interests: string[] };
  setData: (value: Record<string, unknown>) => void;
  onLoad: (query: Record<string, string>) => void; onUnload: () => void;
  phone: (event: { detail: { code: string } }) => Promise<void>; complete: () => Promise<void>;
};
function formRuntime(locationOverrides: Record<string, unknown> = {}) {
  const miniRoot = path.resolve("apps/parent-wechat/miniprogram");
  const policy = { state: "family_required", ticket: "phone-proof", form: { ...DEFAULT_FAMILY_FORM, slug: "family-onboarding", version: 1 },
    maskedPhone: "masked", privacyVersion: "v1", childrenPrivacyVersion: "v1", policyText: { zh: { privacy: "", children: "" }, en: { privacy: "", children: "" } } };
  const wx = { ...runtime(locationOverrides).wx, setNavigationBarTitle: vi.fn(), switchTab: vi.fn(), navigateTo: vi.fn(), setStorageSync: vi.fn(), getStorageSync: vi.fn() };
  class ApiError extends Error { constructor(public code: string) { super(code); } }
  const api = { ApiError, session: () => null,
    loginWithWechat: vi.fn(async () => ({ state: "onboarding_required", ticket: "identity-proof" })),
    authorizeWechatPhone: vi.fn(async () => policy),
    getRegistrationForm: vi.fn(async () => ({ ...policy, accountId: "own-account" })), requestId: () => "11111111-1111-4111-8111-111111111111",
    completeWechatFamily: vi.fn<(ticket: string, family: FamilyRegistration) => Promise<{ grade: null; participantId: null }>>()
      .mockResolvedValue({ grade: null, participantId: null }),
  };
  let page!: OnboardingPage, app!: { onShow?: (options: object) => void };
  const cache = new Map<string, object>();
  function load(file: string): object {
    if (file === path.join(miniRoot, "lib/api.ts")) return api;
    if (file === path.join(miniRoot, "lib/page.ts")) return { pageData: () => ({}), currentLocale: () => "zh", localized: () => ({}), errorText: () => "request failed" };
    if (file === path.join(miniRoot, "lib/navigation.ts")) return { clearNavigation: vi.fn(), selectParticipant: vi.fn(), resumeAfterLogin: () => false };
    if (cache.has(file)) return cache.get(file)!;
    const exports = {};
    cache.set(file, exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
    }).outputText, { exports, wx, Date, setTimeout, clearTimeout,
      require: (relative: string) => load(path.resolve(path.dirname(file), relative + ".ts")),
      Page: (value: OnboardingPage) => { page = value; page.setData = patch => Object.assign(page.data, patch); },
      App: (value: typeof app) => { app = value; },
    });
    return exports;
  }
  load(path.join(miniRoot, "app.ts"));
  load(path.join(miniRoot, "pages/onboarding/index.ts"));
  const entry = load(path.join(miniRoot, "lib/onboarding.ts")) as { openOnboarding: (registration?: boolean) => void; pendingPromotionScene: () => string };
  async function openForm() {
    entry.openOnboarding(); page.onLoad({});
    await vi.waitFor(() => expect(page.data.ticket).toBe("identity-proof"));
    await page.phone({ detail: { code: "phone-code" } });
    page.setData({ consent: true, values: { parentName: "Fixture contact", childName: "Fixture participant", school: "" },
      selection: { relation: 1, gender: 0, grade: 5 }, interests: ["math"] });
  }
  return { wx, api, page, app, entry, openForm };
}

describe("onboarding location boundary", () => {
  it("starts on the public page and sends no identity or permission requests for an old registration QR", () => {
    const config = JSON.parse(fs.readFileSync("apps/parent-wechat/miniprogram/app.json", "utf8"));
    expect(config.pages[0]).toBe("pages/discover/index");
    const run = formRuntime();
    run.app.onShow?.({ query: { scene: "a".repeat(24) }, path: "pages/onboarding/index" });
    run.page.onLoad({ scene: "a".repeat(24), registration: "1" });
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/discover/index" });
    expect(run.api.loginWithWechat).not.toHaveBeenCalled();
    expect(run.api.authorizeWechatPhone).not.toHaveBeenCalled();
    expect(run.api.getRegistrationForm).not.toHaveBeenCalled();
    expect(run.wx.requirePrivacyAuthorize).not.toHaveBeenCalled();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
    expect(run.entry.pendingPromotionScene()).toBe("a".repeat(24));
  });
  it("keeps the scanned channel until a deliberate registration and consumes that entry only once", async () => {
    const run = formRuntime();
    run.app.onShow?.({ query: { scene: "a".repeat(24) } });
    run.app.onShow?.({ query: {} });
    await run.openForm();
    expect(run.api.loginWithWechat).toHaveBeenCalledExactlyOnceWith("a".repeat(24), false);
    run.page.onUnload(); run.page.onLoad({});
    expect(run.api.loginWithWechat).toHaveBeenCalledTimes(1);
    expect(run.wx.switchTab).toHaveBeenLastCalledWith({ url: "/pages/discover/index" });
  });
  it("a failed manual navigation cannot authorize the next scanned entry", () => {
    const run = formRuntime(); run.entry.openOnboarding();
    const options = run.wx.navigateTo.mock.calls[0][0] as { fail: () => void };
    options.fail(); run.page.onLoad({});
    expect(run.api.loginWithWechat).not.toHaveBeenCalled();
    expect(run.wx.switchTab).toHaveBeenCalledWith({ url: "/pages/discover/index" });
  });
  it("does not locate on foreground, scan, WeChat sign-in or phone authorization", async () => {
    const run = formRuntime();
    for (let i = 0; i < 2; i++) {
      run.app.onShow?.({ query: { scene: "a".repeat(24) }, path: "pages/onboarding/index" });
      await run.openForm();
    }
    expect(run.api.loginWithWechat).toHaveBeenCalledWith("a".repeat(24), false);
    expect(run.wx.getSetting).not.toHaveBeenCalled();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
  });
  it.each(["consent", "required-field"])("does not locate or submit before %s is complete", async reason => {
    const run = formRuntime(); await run.openForm();
    if (reason === "consent") run.page.data.consent = false;
    else run.page.data.values.childName = "";
    await run.page.complete();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
    expect(run.api.completeWechatFamily).not.toHaveBeenCalled();
  });
  it("samples once for concurrent clicks and a retry after network failure", async () => {
    const run = formRuntime(); await run.openForm();
    run.api.completeWechatFamily.mockRejectedValueOnce(new run.api.ApiError("NETWORK"));
    await Promise.all([run.page.complete(), run.page.complete()]);
    expect(run.api.completeWechatFamily).toHaveBeenCalledTimes(1);
    const first = run.api.completeWechatFamily.mock.calls[0][1].location;
    await run.page.complete();
    expect(run.api.completeWechatFamily).toHaveBeenCalledTimes(2);
    expect(run.api.completeWechatFamily.mock.calls[1][1].location).toEqual(first);
    expect(first).toMatchObject({ status: "granted", latitude: 30, longitude: 120 });
    expect(run.wx.getLocation).toHaveBeenCalledTimes(1);
    expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });
  it("still submits when location permission was declined", async () => {
    const run = formRuntime({ getSetting: vi.fn(async () => ({ authSetting: { "scope.userLocation": false } })) });
    await run.openForm(); await run.page.complete();
    expect(run.api.completeWechatFamily.mock.calls[0][1].location).toEqual({ status: "declined" });
    expect(run.wx.getLocation).not.toHaveBeenCalled();
  });
  it("does not send a late location after leaving the form", async () => {
    let resolve!: (value: object) => void;
    const run = formRuntime({ getLocation: vi.fn(() => new Promise(done => { resolve = done; })) });
    await run.openForm(); const pending = run.page.complete();
    await vi.waitFor(() => expect(run.wx.getLocation).toHaveBeenCalledOnce());
    run.page.onUnload(); resolve({ latitude: 30, longitude: 120, accuracy: 8 });
    await pending;
    expect(run.api.completeWechatFamily).not.toHaveBeenCalled();
  });
});
