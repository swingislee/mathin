import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  session: { accessToken: "fixture-access", refreshToken: "fixture-session", expiresAt: 0 } as object | null,
  read: vi.fn(), post: vi.fn(),
}));
vi.mock("../apps/parent-wechat/miniprogram/lib/api", () => ({
  ApiError: class extends Error { constructor(public code: string) { super(code); } },
  apiOrigin: () => "http://fixture.invalid", session: () => api.session, runtimeRead: api.read, runtimePost: api.post,
  requestId: () => "10000000-0000-4000-8000-000000000001", logout: vi.fn(), runtimeDownload: vi.fn(), runtimeWebTicket: vi.fn(),
}));

const childA = "10000000-0000-4000-8000-000000000001", childB = "10000000-0000-4000-8000-000000000002";
let runtime: typeof import("../apps/parent-wechat/miniprogram/lib/runtime");
const storage = new Map<string, unknown>();
const view = (participant: string, title = "fixture") => ({ id: "detail", participant, blocks: [], title, participants: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}

beforeEach(async () => {
  vi.resetModules(); api.read.mockReset(); api.post.mockReset(); storage.clear();
  api.session = { accessToken: "fixture-access", refreshToken: "fixture-session", expiresAt: 0 };
  vi.stubGlobal("wx", {
    getStorageSync: (key: string) => storage.get(key), setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    getAppBaseInfo: () => ({ language: "zh" }), showToast: vi.fn(), navigateTo: vi.fn(),
  });
  runtime = await import("../apps/parent-wechat/miniprogram/lib/runtime");
  runtime.setParticipant(childA);
});
afterEach(() => vi.unstubAllGlobals());

describe("runtime object and child context", () => {
  it("separates object parameters from routing and identity, through page, block and command reads", async () => {
    const params = { id: "object-a", participant: "untrusted-object-value", note: "100% & 中文" };
    api.read.mockResolvedValue(view(childA));
    await runtime.loadScreen("detail", params);
    const url = new URL(api.read.mock.calls[0][0], "http://fixture.invalid/");
    expect(url.searchParams.get("id")).toBe("detail");
    expect(url.searchParams.get("participant")).toBe(childA);
    expect(JSON.parse(url.searchParams.get("context")!)).toEqual(params);
    api.read.mockResolvedValue({ revision: "r1", block: null });
    await runtime.loadBlock("detail", "items", { cursor: "next" }, params);
    expect(new URL(api.read.mock.calls[1][0], "http://fixture.invalid/").searchParams.get("context")).toBe(JSON.stringify(params));
    api.post.mockResolvedValue({ effects: [] });
    await runtime.runCommand("form.submit", { formId: "request" }, { screen: "detail", block: "form", params });
    expect(api.post.mock.calls[0][1]).toMatchObject({ participant: childA, context: params, params: { formId: "request" } });
  });

  it("keeps two objects on the same screen and two children in separate caches", async () => {
    api.read.mockResolvedValueOnce(view(childA, "object-a")).mockResolvedValueOnce(view(childA, "object-b"));
    await runtime.loadScreen("detail", { id: "a" });
    await runtime.loadScreen("detail", { id: "b" });
    expect(runtime.cachedScreen("detail", { id: "a" })?.title).toBe("object-a");
    expect(runtime.cachedScreen("detail", { id: "b" })?.title).toBe("object-b");
    runtime.setParticipant(childB);
    expect(runtime.cachedScreen("detail", { id: "a" })).toBeNull();
  });

  it("rejects a late child A response after switching to B without switching back", async () => {
    const pending = deferred<ReturnType<typeof view>>();
    api.read.mockReturnValueOnce(pending.promise);
    const result = runtime.loadScreen("detail");
    runtime.setParticipant(childB);
    pending.resolve(view(childA));
    await expect(result).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    expect(runtime.currentParticipant()).toBe(childB);
    expect(runtime.cachedScreen("detail")).toBeNull();
  });

  it("refreshes navigation for the chosen child and ignores the old shell's late response", async () => {
    const pendingA = deferred<unknown>(), pendingB = deferred<unknown>();
    const shell = runtime.currentApp();
    api.read.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise);
    const first = runtime.refreshApp(true);
    runtime.setParticipant(childB);
    const second = runtime.refreshApp(true);
    expect(api.read.mock.calls.map(([url]) => new URL(url, "http://fixture.invalid/").searchParams.get("participant"))).toEqual([childA, childB]);
    pendingB.resolve({ ...shell, signedIn: true, participant: childB, revision: "r2", tabs: [{ ...shell.tabs[0], label: "B" }] });
    await second;
    pendingA.resolve({ ...shell, signedIn: true, participant: childA, revision: "r1" });
    await first;
    expect(runtime.currentApp().revision).toBe("r2");
    expect(runtime.currentApp().tabs[0].label).toBe("B");
    expect([...storage.keys()].some(key => key.includes("-member"))).toBe(false);
  });

  it("keeps unknown and known URL values intact when opening a screen", async () => {
    await runtime.runAction({ type: "screen", screen: "detail", params: { id: "object", note: "100% & 中文" } });
    const url = new URL(vi.mocked(wx.navigateTo).mock.calls[0][0].url, "http://fixture.invalid");
    expect(url.searchParams.get("id")).toBe("detail");
    expect(JSON.parse(url.searchParams.get("params")!)).toEqual({ id: "object", note: "100% & 中文" });
  });

  it("discards command effects after a child change and stops rejected commands from continuing", async () => {
    const pending = deferred<{ effects: { type: string }[] }>();
    api.post.mockReturnValueOnce(pending.promise);
    const result = runtime.runCommand("checkin", {}, { screen: "account", block: "" });
    runtime.setParticipant(childB); pending.resolve({ effects: [{ type: "refresh" }] });
    await expect(result).rejects.toMatchObject({ code: "CONTEXT_CHANGED" });
    api.post.mockResolvedValueOnce({ accepted: false, effects: [] });
    await expect(runtime.runCommand("future", {}, { screen: "account", block: "" })).rejects.toMatchObject({ code: "UPDATE_REQUIRED" });
  });
});
