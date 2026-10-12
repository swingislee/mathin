import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { Account, WechatAuthResult, WechatAuthStatus, Session } from "../contracts/participant-api/portal";

type Request = {
  url: string; data: Record<string, unknown>; header: Record<string, string>;
  success: (result: { statusCode: number; data: unknown }) => void;
};
type Login = { success: (result: { code?: string }) => void; fail: () => void };
type Api = {
  wechatAuthStatus: () => Promise<WechatAuthStatus>;
  loginWithWechat: (scene?: string, useCurrentSession?: boolean) => Promise<WechatAuthResult>;
  bindWechat: () => Promise<void>;
  saveSession: (value: Session) => void;
  clearSession: () => void;
  cancelPendingAuthentication: () => void;
};
const active = (name: string): Session => ({ accessToken: name, refreshToken: `${name}-refresh`, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
const miniRoot = path.resolve("apps/parent-wechat/miniprogram");
const compile = (file: string) => ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;

function apiRuntime(initial: Session | null = null) {
  let current = initial;
  const requests: Request[] = [], logins: Login[] = [];
  const wx = {
    getStorageSync: () => current,
    setStorageSync: vi.fn((_key: string, value: Session) => { current = value; }),
    removeStorageSync: () => { current = null; },
    request: (request: Request) => requests.push(request),
    login: (login: Login) => logins.push(login),
  };
  const exports = {};
  vm.runInNewContext(compile(path.join(miniRoot, "lib/api.ts")), {
    exports, wx, console,
    require: () => ({ config: { apiOrigin: "http://development.invalid" } }),
  });
  return { api: exports as Api, requests, logins, wx, current: () => current };
}

type Page = {
  data: {
    authenticated: boolean; busy: boolean; wantsWechatBinding: boolean;
    sheet: string; error: string; info: string; account: Account | null;
    wechat: WechatAuthStatus | null; wechatLoading: boolean; wechatStatusFailed: boolean;
  };
  setData: (patch: Record<string, unknown>) => void;
  onShow: () => void; onHide: () => void;
  signInWithWechat: () => Promise<void>;
  confirmWechatBinding: () => Promise<void>; showWechatBinding: () => void;
  skipWechatBinding: () => void; loadWechat: () => Promise<void>;
  closeSheet: () => void; showAccount: () => void; browse: () => void;
};
class ClientError extends Error { constructor(public code: string, public reason?: string) { super(code); } }
function pageRuntime(overrides: Record<string, unknown> = {}, language = "zh_CN", returnTo: string | null = "/pages/assessment/index") {
  let page: Page;
  const wx = {
    getAppBaseInfo: () => ({ language }), setNavigationBarTitle: vi.fn(), setTabBarItem: vi.fn(),
    navigateTo: vi.fn(), switchTab: vi.fn(), showModal: vi.fn(), getLocation: vi.fn(), getSetting: vi.fn(),
  };
  const api = {
    ApiError: ClientError, session: () => null, cancelPendingAuthentication: vi.fn(),
    wechatAuthStatus: vi.fn(async () => ({ available: true, linked: null, canBind: false })),
    get: vi.fn(async () => ({ id: "account", displayName: "Demo account", participants: [] })),
    ...overrides,
  };
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    if (file === path.join(miniRoot, "lib/api.ts")) return api;
    if (cache.has(file)) return cache.get(file)!;
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    vm.runInNewContext(compile(file), {
      exports, wx, console,
      require: (relative: string) => load(path.resolve(path.dirname(file), relative + ".ts")),
      Page: (value: Page) => { page = value; page.setData = patch => Object.assign(page.data, patch); },
    });
    return exports;
  }
  const navigation = load(path.join(miniRoot, "lib/navigation.ts")) as { requestLogin: (url: string) => void };
  if (returnTo) navigation.requestLogin(returnTo);
  load(path.join(miniRoot, "pages/account/index.ts"));
  return { page: page!, wx, api };
}

describe("小程序微信鉴权传输", () => {
  it("匿名能力查询不发Bearer，配置关闭时不产生会话", async () => {
    const run = apiRuntime();
    const status = run.api.wechatAuthStatus();
    expect(run.requests[0].url).toContain("/auth/wechat");
    expect(run.requests[0].header.Authorization).toBeUndefined();
    run.requests[0].success({ statusCode: 200, data: { available: false, linked: null, canBind: false } });
    await expect(status).resolves.toEqual({ available: false, linked: null, canBind: false });
    expect(run.current()).toBeNull();
  });

  it.each(["failure", "empty"])("wx.login %s 时不发认证请求", async kind => {
    const run = apiRuntime();
    const pending = expect(run.api.loginWithWechat()).rejects.toMatchObject({ reason: "WECHAT_CODE_INVALID" });
    if (kind === "failure") run.logins[0].fail(); else run.logins[0].success({});
    await pending;
    expect(run.requests).toHaveLength(0);
    expect(run.current()).toBeNull();
  });

  it("未知微信仅提交code并保留未登录状态", async () => {
    const run = apiRuntime();
    const pending = run.api.loginWithWechat();
    run.logins[0].success({ code: "temporary-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    expect(run.requests[0].data).toEqual({ action: "login", code: "temporary-code" });
    run.requests[0].success({ statusCode: 200, data: { state: "binding_required" } });
    await expect(pending).resolves.toEqual({ state: "binding_required" });
    expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });

  it("已绑定微信保存服务端返回的现有账号会话", async () => {
    const run = apiRuntime();
    const pending = run.api.loginWithWechat();
    run.logins[0].success({ code: "temporary-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    run.requests[0].success({ statusCode: 200, data: { state: "authenticated", session: active("account") } });
    await pending;
    expect(run.current()?.accessToken).toBe("account");
  });

  it("取得code期间退出或切换会话，终止旧登录", async () => {
    const run = apiRuntime();
    const rejected = expect(run.api.loginWithWechat()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    run.api.clearSession();
    run.logins[0].success({ code: "late-code" });
    await rejected;
    expect(run.requests).toHaveLength(0);
  });

  it("在途微信登录响应不能覆盖后来登录的账号", async () => {
    const run = apiRuntime();
    const rejected = expect(run.api.loginWithWechat()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    run.logins[0].success({ code: "temporary-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    run.api.saveSession(active("newer"));
    run.requests[0].success({ statusCode: 200, data: { state: "authenticated", session: active("old") } });
    await rejected;
    expect(run.current()?.accessToken).toBe("newer");
  });

  it("取消授权丢弃迟到登录响应，同时保留已有账号会话", async () => {
    const original = active("current"), run = apiRuntime(original);
    const rejected = expect(run.api.loginWithWechat()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    run.logins[0].success({ code: "temporary-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    run.api.cancelPendingAuthentication();
    run.requests[0].success({ statusCode: 200, data: { state: "authenticated", session: active("late") } });
    await rejected;
    expect(run.current()).toBe(original);
    expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });

  it("绑定带当前Bearer与显式确认，不替换当前会话", async () => {
    const original = active("current");
    const run = apiRuntime(original);
    const pending = run.api.bindWechat();
    await vi.waitFor(() => expect(run.logins).toHaveLength(1));
    run.logins[0].success({ code: "new-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    expect(run.requests[0].header.Authorization).toBe("Bearer current");
    expect(run.requests[0].data).toEqual({ action: "bind", code: "new-code", confirm: true });
    run.requests[0].success({ statusCode: 200, data: { state: "bound" } });
    await pending;
    expect(run.current()).toBe(original);
    expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });

  it("只保留稳定错误原因，不传播服务器额外消息", async () => {
    const run = apiRuntime();
    const rejected = expect(run.api.loginWithWechat()).rejects.toMatchObject({ code: "UNAVAILABLE", reason: "WECHAT_UNIONID_REQUIRED", message: "UNAVAILABLE" });
    run.logins[0].success({ code: "temporary-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    run.requests[0].success({ statusCode: 503, data: { code: "UNAVAILABLE", reason: "WECHAT_UNIONID_REQUIRED", message: "upstream details" } });
    await rejected;
  });
  it("已登录账号继续登记时携带当前会话，完成后保留原凭据", async () => {
    const original = active("current"), run = apiRuntime(original);
    const pending = run.api.loginWithWechat("a".repeat(24), true);
    await vi.waitFor(() => expect(run.logins).toHaveLength(1));
    run.logins[0].success({ code: "current-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    expect(run.requests[0].header.Authorization).toBe("Bearer current");
    expect(run.requests[0].data.scene).toBe("a".repeat(24));
    run.requests[0].success({ statusCode: 200, data: { state: "current_session" } });
    await expect(pending).resolves.toEqual({ state: "current_session" });
    expect(run.current()).toBe(original); expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });
});

describe("小程序微信登录与明确绑定", () => {
  it.each(["onboarding_required", "authenticated"])("取消等待中的登录后，%s 迟到响应不会打开页面或恢复登录", async state => {
    let finish!: () => void;
    const loginWithWechat = vi.fn(() => new Promise(resolve => { finish = () => resolve({ state, ticket: "late-proof" }); }));
    const run = pageRuntime({ loginWithWechat });
    run.page.showAccount(); await run.page.loadWechat();
    const pending = run.page.signInWithWechat();
    expect(run.page.data.busy).toBe(true);
    run.page.browse();
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/discover/index" });
    expect(run.api.cancelPendingAuthentication).toHaveBeenCalledOnce();
    finish(); await pending;
    expect(run.page.data).toMatchObject({ authenticated: false, busy: false, sheet: "", error: "" });
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.api.get).not.toHaveBeenCalled();
    run.page.onShow();
    expect(run.page.data.sheet).toBe("");
  });

  it("游客进入我的仅展示入口，主动点击后才显示微信登录", () => {
    const loginWithWechat = vi.fn(), run = pageRuntime({ loginWithWechat }, "zh_CN", null);
    run.page.onShow();
    expect(run.page.data.sheet).toBe("");
    expect(loginWithWechat).not.toHaveBeenCalled();
    expect(run.api.get).not.toHaveBeenCalled();
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
    run.page.showAccount();
    expect(run.page.data.sheet).toBe("login");
    expect(loginWithWechat).not.toHaveBeenCalled();
  });
  it("关闭登录后重新打开我的不重复弹层，也不自动返回未完成的业务", async () => {
    const loginWithWechat = vi.fn(async () => ({ state: "authenticated" })), run = pageRuntime({ loginWithWechat });
    run.page.onShow(); expect(run.page.data.sheet).toBe("login");
    run.page.closeSheet(); run.page.onHide(); run.page.onShow();
    expect(run.page.data.sheet).toBe("");
    expect(loginWithWechat).not.toHaveBeenCalled();
    run.page.showAccount(); await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
  });
  it("未配置时保留未登录状态，不能进入受保护的业务页", async () => {
    const loginWithWechat = vi.fn();
    const run = pageRuntime({ loginWithWechat,
      wechatAuthStatus: vi.fn(async () => ({ available: false, linked: null, canBind: false })) });
    await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(loginWithWechat).not.toHaveBeenCalled();
    expect(run.page.data.authenticated).toBe(false);
    expect(run.api.get).not.toHaveBeenCalled();
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
  });

  it("新微信进入手机号授权与家庭开户，不显示密码选择", async () => {
    const run = pageRuntime({
      loginWithWechat: vi.fn(async () => ({ state: "onboarding_required", ticket: "a".repeat(64) })),
    });
    await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(run.page.data.authenticated).toBe(false);
    expect(run.page.data.wantsWechatBinding).toBe(false);
    expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/onboarding/index", fail: expect.any(Function) });
    expect(run.api.loginWithWechat).toHaveBeenCalledWith(undefined);
    expect(run.wx.getLocation).not.toHaveBeenCalled();
    expect(run.wx.getSetting).not.toHaveBeenCalled();
  });

  it("未关联微信提示联系工作人员核对，不自动创建账号", async () => {
    const run = pageRuntime({ loginWithWechat: vi.fn(async () => ({ state: "binding_required" })) });
    await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(run.page.data.wantsWechatBinding).toBe(false);
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.page.data.info).toContain("联系工作人员");
  });

  it("只有服务端允许直接绑定时才发送确认并返回业务入口", async () => {
    const bindWechat = vi.fn(async () => {}), run = pageRuntime({ bindWechat });
    run.page.setData({ account: { id: "account", displayName: "Demo", participants: [] },
      wechat: { available: true, linked: false, canBind: true, canBindDirect: false } });
    run.page.showWechatBinding();
    await run.page.confirmWechatBinding();
    expect(run.page.data.sheet).toBe("");
    expect(bindWechat).not.toHaveBeenCalled();
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    run.page.setData({ wechat: { available: true, linked: false, canBind: true, canBindDirect: true } });
    run.page.showWechatBinding();
    await run.page.confirmWechatBinding();
    expect(bindWechat).toHaveBeenCalledExactlyOnceWith();
    expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/assessment/index" });
  });

  it("安全验证被拒绝时不返回业务页，显示可理解原因", async () => {
    const run = pageRuntime({
      bindWechat: vi.fn(async () => { throw new ClientError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED"); }),
      wechatAuthStatus: vi.fn(async () => ({ available: true, linked: false, canBind: false })),
    }, "en_US");
    run.page.onShow();
    run.page.setData({ account: { id: "account", displayName: "Demo", participants: [] },
      wechat: { available: true, linked: false, canBind: true, canBindDirect: true }, sheet: "bind", wantsWechatBinding: true });
    await run.page.confirmWechatBinding();
    expect(run.page.data.error).toContain("security verification");
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.page.data.wechat?.canBind).toBe(false);
  });

  it("绑定可跳过，继续使用已有账号和原业务入口", () => {
    const run = pageRuntime();
    run.page.setData({ account: { id: "account", displayName: "Demo", participants: [] }, sheet: "bind", wantsWechatBinding: true });
    run.page.skipWechatBinding();
    expect(run.page.data.wantsWechatBinding).toBe(false);
    expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/assessment/index" });
  });

  it("离开页面后丢弃旧能力响应", async () => {
    let resolve!: (value: WechatAuthStatus) => void;
    const run = pageRuntime({ wechatAuthStatus: () => new Promise<WechatAuthStatus>(done => { resolve = done; }) });
    const pending = run.page.loadWechat();
    run.page.onHide();
    resolve({ available: true, linked: true, canBind: false });
    await pending;
    expect(run.page.data.wechat).toBeNull();
  });
});
