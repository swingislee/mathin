import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ token: "", get: vi.fn(), experienceRequest: vi.fn() }));
vi.mock("../apps/parent-wechat/miniprogram/lib/api", () => ({ get: api.get, experienceRequest: api.experienceRequest, session: () => api.token ? { accessToken: api.token } : null }));
vi.mock("../apps/parent-wechat/miniprogram/lib/page", () => ({ date: (v: string) => v, errorText: () => "Unavailable", loginPage: vi.fn() }));
vi.mock("../apps/parent-wechat/miniprogram/lib/miniapp-configuration", () => ({ openConfiguredAction: vi.fn() }));
type Instance = { data: Record<string, unknown>; setData: ReturnType<typeof vi.fn>; load: () => Promise<void> };
type Definition = { data: Record<string, unknown>; methods: { load: Instance["load"] }; lifetimes: { attached: (this: Instance) => void; detached: (this: Instance) => void }; pageLifetimes: { show: (this: Instance) => void; hide: (this: Instance) => void } };
let component: Definition;
beforeAll(async () => { vi.stubGlobal("Component", (value: Definition) => { component = value; }); await import("../apps/parent-wechat/miniprogram/components/account-records/index"); });
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { api.token = ""; api.get.mockReset(); api.experienceRequest.mockReset(); });
function mount() {
  const instance = { ...component.methods, data: { ...component.data, source: "tasks", limit: 3, locale: "zh" }, setData: vi.fn(function(this: Instance, next: Record<string, unknown>) { Object.assign(this.data, next); }) };
  component.lifetimes.attached.call(instance);
  return instance;
}
const task = (title: string) => ({ id: title, participantId: "participant-fixture", participantName: "Fixture", title, dueAt: "", submittedAt: null });
async function flush() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

describe("current-account record module", () => {
  it("does not request personal data for signed-out visitors", async () => {
    const instance = mount(); await flush();
    expect(api.get).not.toHaveBeenCalled(); expect(api.experienceRequest).not.toHaveBeenCalled();
    expect(instance.data.authenticated).toBe(false); expect(instance.data.rows).toEqual([]);
  });
  it("clears records on hide and rejects an old account's late response", async () => {
    api.token = "fixture-session-a";
    let oldResponse!: (value: unknown[]) => void;
    api.get.mockReturnValueOnce(new Promise(resolve => { oldResponse = resolve; }));
    const instance = mount();
    component.pageLifetimes.hide.call(instance);
    expect(instance.data.rows).toEqual([]);
    api.token = "fixture-session-b"; api.get.mockResolvedValueOnce([task("current")]);
    component.pageLifetimes.show.call(instance); await flush();
    oldResponse([task("old-private")]); await flush();
    expect(instance.data.rows).toEqual([expect.objectContaining({ title: "current" })]);
    expect(JSON.stringify(instance.setData.mock.calls)).not.toContain("fixture-session");
    component.lifetimes.detached.call(instance);
  });
  it("checks the actual session again before displaying an in-flight result", async () => {
    api.token = "fixture-session-a";
    let resolve!: (value: unknown[]) => void;
    api.get.mockReturnValue(new Promise(done => { resolve = done; }));
    const instance = mount(); api.token = ""; resolve([task("private")]); await flush();
    expect(instance.data.rows).toEqual([]); expect(instance.data.authenticated).toBe(false);
    component.lifetimes.detached.call(instance);
  });
  it("bounds displayed results and does not apply responses to a detached component", async () => {
    api.token = "fixture-session"; api.get.mockResolvedValueOnce([1, 2, 3, 4].map(i => task(String(i))));
    const instance = mount(); await flush(); expect(instance.data.rows).toHaveLength(3);
    component.pageLifetimes.hide.call(instance);
    let resolve!: (value: unknown[]) => void;
    api.get.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    component.pageLifetimes.show.call(instance); component.lifetimes.detached.call(instance);
    instance.setData.mockClear(); resolve([task("late")]); await flush(); expect(instance.setData).not.toHaveBeenCalled();
  });
});
