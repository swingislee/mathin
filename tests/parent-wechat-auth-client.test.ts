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
  bindWechat: (password?: string) => Promise<void>;
  saveSession: (value: Session) => void;
  clearSession: () => void;
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
    authenticated: boolean; identifier: string; password: string; busy: boolean; wantsWechatBinding: boolean;
    sheet: string; error: string; info: string; account: Account | null;
    wechat: WechatAuthStatus | null; wechatLoading: boolean; wechatStatusFailed: boolean;
  };
  setData: (patch: Record<string, unknown>) => void;
  onShow: () => void; onHide: () => void;
  signIn: () => Promise<void>; signInWithWechat: () => Promise<void>;
  confirmWechatBinding: () => Promise<void>; showWechatBinding: () => void;
  skipWechatBinding: () => void; loadWechat: () => Promise<void>;
  closeSheet: () => void; showAccount: () => void;
};
class ClientError extends Error { constructor(public code: string, public reason?: string) { super(code); } }
function pageRuntime(overrides: Record<string, unknown> = {}, language = "zh_CN", returnTo: string | null = "/pages/assessment/index") {
  let page: Page;
  const wx = {
    getAppBaseInfo: () => ({ language }), setNavigationBarTitle: vi.fn(), setTabBarItem: vi.fn(),
    navigateTo: vi.fn(), switchTab: vi.fn(), showModal: vi.fn(), getLocation: vi.fn(), getSetting: vi.fn(),
  };
  const api = {
    ApiError: ClientError, session: () => null,
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

  it("绑定带当前Bearer、原密码与显式确认，不替换当前会话", async () => {
    const original = active("current");
    const run = apiRuntime(original);
    const pending = run.api.bindWechat("example-password");
    await vi.waitFor(() => expect(run.logins).toHaveLength(1));
    run.logins[0].success({ code: "new-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    expect(run.requests[0].header.Authorization).toBe("Bearer current");
    expect(run.requests[0].data).toEqual({ action: "bind", code: "new-code", password: "example-password", confirm: true });
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
  it("直接绑定仍发送当前会话和本人确认", async () => {
    const run = apiRuntime(active("current"));
    const pending = run.api.bindWechat();
    await vi.waitFor(() => expect(run.logins).toHaveLength(1));
    run.logins[0].success({ code: "current-code" });
    await vi.waitFor(() => expect(run.requests).toHaveLength(1));
    expect(run.requests[0].header.Authorization).toBe("Bearer current");
    expect(run.requests[0].data).toEqual({ action: "bind", code: "current-code", confirm: true });
    run.requests[0].success({ statusCode: 200, data: { state: "bound" } }); await pending;
  });
});

describe("小程序微信登录与明确绑定", () => {
  it("游客进入我的仅展示入口，主动点击登录后才显示登录选择", () => {
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
    const loginWithWechat = vi.fn(), run = pageRuntime({ login: vi.fn(), loginWithWechat });
    run.page.onShow(); expect(run.page.data.sheet).toBe("login");
    run.page.closeSheet(); run.page.onHide(); run.page.onShow();
    expect(run.page.data.sheet).toBe("");
    expect(loginWithWechat).not.toHaveBeenCalled();
    run.page.showAccount(); run.page.setData({ identifier: "example-account", password: "example-password" });
    await run.page.signIn();
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
  });
  it("未配置时不调用微信登录，密码仍可进入并返回测评页", async () => {
    const login = vi.fn(async () => {}), loginWithWechat = vi.fn();
    const run = pageRuntime({ login, loginWithWechat,
      wechatAuthStatus: vi.fn(async () => ({ available: false, linked: null, canBind: false })) });
    await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(loginWithWechat).not.toHaveBeenCalled();
    run.page.setData({ identifier: "example-account", password: "example-password" });
    await run.page.signIn();
    expect(login).toHaveBeenCalledWith("example-account", "example-password");
    expect(run.page.data.password).toBe("");
    expect(run.wx.navigateTo).toHaveBeenCalledExactlyOnceWith({ url: "/pages/assessment/index" });
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

  it("已有账号提示首次绑定，不自动改成密码登录或创建账号", async () => {
    const run = pageRuntime({ loginWithWechat: vi.fn(async () => ({ state: "binding_required" })) });
    await run.page.loadWechat();
    await run.page.signInWithWechat();
    expect(run.page.data.wantsWechatBinding).toBe(false);
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.page.data.info).toContain("绑定当前微信");
  });

  it("原密码或MFA被拒绝时不返回业务页，清空密码并显示可理解原因", async () => {
    const run = pageRuntime({
      bindWechat: vi.fn(async () => { throw new ClientError("ACCOUNT_SECURITY", "WECHAT_MFA_REQUIRED"); }),
      wechatAuthStatus: vi.fn(async () => ({ available: true, linked: false, canBind: false })),
    }, "en_US");
    run.page.onShow();
    run.page.setData({ account: { id: "account", displayName: "Demo", participants: [] }, password: "example-password",
      wechat: { available: true, linked: false, canBind: true }, sheet: "bind", wantsWechatBinding: true });
    await run.page.confirmWechatBinding();
    expect(run.page.data.error).toContain("security verification");
    expect(run.page.data.password).toBe("");
    expect(run.wx.navigateTo).not.toHaveBeenCalled();
    expect(run.page.data.wechat?.canBind).toBe(false);
  });

  it("绑定可跳过，继续使用已有账号和原业务入口", () => {
    const run = pageRuntime();
    run.page.setData({ account: { id: "account", displayName: "Demo", participants: [] }, password: "example-password", sheet: "bind", wantsWechatBinding: true });
    run.page.skipWechatBinding();
    expect(run.page.data.wantsWechatBinding).toBe(false);
    expect(run.page.data.password).toBe("");
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
