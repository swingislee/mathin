import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "../contracts/participant-api/portal";

const root = path.resolve("apps/parent-wechat/miniprogram");
const compile = (file: string) => ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
}).outputText;
class ClientError extends Error { constructor(public code: string) { super(code); } }
type BindingPage = {
  data: { stage: string; code: string; ticket: string; policy: unknown; consent: boolean; parentName: string;
    relation: number; childName: string; error: string; busy: boolean };
  setData: (patch: Record<string, unknown>) => void;
  onLoad: (query: Record<string, string>) => void; onUnload: () => void;
  preview: () => Promise<void>; start: () => Promise<void>; confirm: () => Promise<void>;
  phone: (event: { detail: { code?: string } }) => Promise<void>;
  browse: () => void;
};
const invitation = "a".repeat(32), ticket = "b".repeat(64), childId = "child-id";
const confirmationStep = { state: "confirmation_required", ticket, maskedPhone: "+8619****0001",
  privacyVersion: "v1", childrenPrivacyVersion: "v1", policyText: { zh: { privacy: "隐私", children: "儿童" }, en: { privacy: "Privacy", children: "Children" } } };
function runtime() {
  let page: BindingPage;
  const wx = { getAppBaseInfo: () => ({ language: "zh_CN" }), setNavigationBarTitle: vi.fn(), switchTab: vi.fn(),
    setStorageSync: vi.fn(), getStorageSync: vi.fn(), login: vi.fn(), request: vi.fn(), showModal: vi.fn() };
  const api = { ApiError: ClientError, cancelPendingAuthentication: vi.fn(),
    guardianBindingPreview: vi.fn(async () => ({ maskedName: "测＊", expiresAt: "2026-10-18T00:00:00Z" })),
    beginGuardianBinding: vi.fn(async () => ({ state: "phone_required", ticket } as object)),
    guardianBindingPhone: vi.fn(async () => confirmationStep),
    confirmGuardianBinding: vi.fn(async () => ({ participantId: childId })),
    get: vi.fn(async () => ({ participants: [{ id: childId, name: "完整姓名" }] })),
  };
  const cache = new Map<string, object>();
  function load(file: string): object {
    if (file === path.join(root, "lib/api.ts")) return api;
    if (cache.has(file)) return cache.get(file)!;
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(compile(file), { exports, wx, console,
      require: (relative: string) => load(path.resolve(path.dirname(file), relative + ".ts")),
      Page: (value: BindingPage) => { page = value; page.setData = patch => Object.assign(page.data, patch); },
    });
    return exports;
  }
  load(path.join(root, "pages/guardian-binding/index.ts"));
  return { page: page!, api, wx };
}
async function ready() {
  const run = runtime(); run.page.onLoad({}); run.page.data.code = invitation; await run.page.preview();
  run.api.beginGuardianBinding.mockResolvedValue(confirmationStep); await run.page.start();
  run.page.data.parentName = "事务家长"; run.page.data.relation = 1;
  return run;
}

describe("guardian binding native page", () => {
  it("declining phone authorization returns to browsing without linking a child", async () => {
    const run = runtime(); run.page.onLoad({}); run.page.data.code = invitation;
    await run.page.preview(); await run.page.start();
    await run.page.phone({ detail: {} });
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/discover/index" });
    expect(run.page.data.ticket).toBe("");
    expect(run.api.guardianBindingPhone).not.toHaveBeenCalled();
    expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled();
  });

  it("cancelling pending phone verification ignores the late confirmation form", async () => {
    const run = runtime(); run.page.onLoad({}); run.page.data.code = invitation;
    await run.page.preview(); await run.page.start();
    let finish!: () => void;
    run.api.guardianBindingPhone.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(confirmationStep); }));
    const pending = run.page.phone({ detail: { code: "phone-code" } });
    run.page.browse();
    finish(); await pending;
    expect(run.page.data).toMatchObject({ busy: false, ticket: "", policy: null, consent: false });
    expect(run.page.data.stage).not.toBe("confirm");
    expect(run.wx.switchTab).toHaveBeenCalledExactlyOnceWith({ url: "/pages/discover/index" });
    expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled();
    expect(run.api.get).not.toHaveBeenCalled();
  });

  it("scanning reads only the partial-name invitation and never starts authorization", async () => {
    const run = runtime(); run.page.onLoad({ scene: invitation });
    await vi.waitFor(() => expect(run.page.data.stage).toBe("preview"));
    expect(run.api.guardianBindingPreview).toHaveBeenCalledExactlyOnceWith(invitation);
    expect(run.page.data.stage).toBe("preview");
    expect(run.api.beginGuardianBinding).not.toHaveBeenCalled(); expect(run.api.guardianBindingPhone).not.toHaveBeenCalled();
    expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled(); expect(run.api.get).not.toHaveBeenCalled();
    expect(run.wx.login).not.toHaveBeenCalled(); expect(run.wx.setStorageSync).not.toHaveBeenCalled();
  });
  it("phone authorization requires a tap and still leaves the confirmation unchecked", async () => {
    const run = runtime(); run.page.onLoad({}); run.page.data.code = invitation; await run.page.preview();
    await run.page.start(); expect(run.page.data.stage).toBe("phone");
    expect(run.api.guardianBindingPhone).not.toHaveBeenCalled();
    await run.page.phone({ detail: { code: "phone-code" } }); expect(run.page.data.stage).toBe("confirm");
    expect(run.page.data.consent).toBe(false); expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled();
    expect(run.api.get).not.toHaveBeenCalled();
  });
  it("only a checked, explicit confirmation exposes the linked child's full name", async () => {
    const run = await ready(); await run.page.confirm(); expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled();
    run.page.data.consent = true; await run.page.confirm();
    expect(run.api.confirmGuardianBinding).toHaveBeenCalledExactlyOnceWith(ticket, { parentName: "事务家长", relation: "mother", consent: true,
      privacyVersion: "v1", childrenPrivacyVersion: "v1" });
    expect(run.page.data.stage).toBe("done"); expect(run.page.data.childName).toBe("完整姓名");
    expect(run.page.data.ticket).toBe(""); expect(run.page.data.policy).toBeNull();
    expect(run.api.get.mock.invocationCallOrder[0]).toBeGreaterThan(run.api.confirmGuardianBinding.mock.invocationCallOrder[0]);
  });
  it("a lost response keeps the short proof for the same explicit confirmation's retry", async () => {
    const run = await ready(); run.page.data.consent = true;
    run.api.confirmGuardianBinding.mockRejectedValueOnce(new ClientError("NETWORK"));
    await run.page.confirm(); expect(run.page.data.stage).toBe("confirm"); expect(run.page.data.ticket).toBe(ticket);
    await run.page.confirm(); expect(run.page.data.stage).toBe("done");
    expect(run.api.confirmGuardianBinding.mock.calls[0]).toEqual(run.api.confirmGuardianBinding.mock.calls[1]);
  });
  it("leaving clears identity and phone proofs without saving them to storage", async () => {
    const run = await ready(); run.page.onUnload();
    expect(run.page.data.ticket).toBe(""); expect(run.page.data.policy).toBeNull();
    expect(run.wx.setStorageSync).not.toHaveBeenCalled(); expect(run.api.confirmGuardianBinding).not.toHaveBeenCalled();
  });
});

describe("guardian session response isolation", () => {
  it("a confirmation response cannot restore an account after logout", async () => {
    let current: Session | null = null;
    let response: { success: (value: object) => void };
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    const wx = { getStorageSync: () => current, setStorageSync: (_key: string, value: Session) => { current = value; },
      removeStorageSync: () => { current = null; }, request: (value: typeof response) => { response = value; } };
    vm.runInNewContext(compile(path.join(root, "lib/api.ts")), { exports, wx, console,
      require: () => ({ config: { apiOrigin: "http://development.invalid" } }) });
    const result = exports.confirmGuardianBinding(ticket, { consent: true }) as Promise<unknown>;
    const rejected = expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    exports.clearSession();
    response!.success({ statusCode: 200, data: { state: "authenticated", session: { accessToken: "old", refreshToken: "old-refresh", expiresAt: 1_900_000_000 } } });
    await rejected; expect(current).toBeNull();
  });
});
