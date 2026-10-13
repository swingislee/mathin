import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMiniappSettings } from "../contracts/participant-api/miniapp-settings";
import { defaultMiniappExperience } from "../contracts/participant-api/miniapp-experience-templates";
import { nativeScreenDefault } from "../contracts/participant-api/miniapp-native";

const api = vi.hoisted(() => ({ miniappSettings: vi.fn() }));
vi.mock("../apps/parent-wechat/miniprogram/config.local", () => ({ config: { apiOrigin: "http://127.0.0.1:3130" } }));
vi.mock("../apps/parent-wechat/miniprogram/lib/api", () => ({
  miniappSettings: api.miniappSettings, miniappContentImage: () => "", session: () => null,
}));

type ScreenPage = {
  data: { locale: string; configurationRevision?: number; screen: { title: string } };
  setData: (values: Record<string, unknown>) => void;
};
type PageOptions = { data: ScreenPage["data"]; onShow: (this: ScreenPage) => void };
const titled = (title: string) => {
  const config = defaultMiniappSettings();
  return { ...config, experience: { ...defaultMiniappExperience(config), screens: [
    { ...nativeScreenDefault("discover"), title: { zh: title, en: "" } },
  ] } };
};

beforeEach(() => { vi.resetModules(); api.miniappSettings.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("published configuration on the first page show", () => {
  it.each(["new title", "remove customization"])("updates the page and its wrapper together: %s", async scenario => {
    const next = scenario === "new title" ? titled("更新后的标题") : defaultMiniappSettings();
    let resolve!: (value: unknown) => void;
    api.miniappSettings.mockReturnValue(new Promise(done => { resolve = done; }));
    const setNavigationBarTitle = vi.fn();
    vi.stubGlobal("wx", {
      getStorageSync: () => ({ revision: 1, config: titled("原来的标题"), checkedAt: Date.now() - 61_000 }),
      setStorageSync: vi.fn(), getAppBaseInfo: () => ({ language: "zh_CN" }),
      getDeviceInfo: () => ({ platform: "devtools" }), setTabBarItem: vi.fn(), setNavigationBarTitle,
    });
    let options!: PageOptions;
    vi.stubGlobal("Page", (value: PageOptions) => { options = value; });
    const { configuredPage } = await import("../apps/parent-wechat/miniprogram/lib/native-page");
    const { pageData, syncPage } = await import("../apps/parent-wechat/miniprogram/lib/page");
    configuredPage("discover")({ data: pageData("discover"), onShow() { syncPage(this, "discover"); } });
    const page: ScreenPage = { data: { ...options.data }, setData(values) { Object.assign(this.data, values); } };
    options.onShow.call(page);
    expect(page.data.screen.title).toBe("原来的标题");
    expect(api.miniappSettings).toHaveBeenCalledTimes(1);
    resolve({ revision: 2, config: next });
    await vi.waitFor(() => expect(page.data.configurationRevision).toBe(2));
    expect(page.data.screen.title).toBe(scenario === "new title" ? "更新后的标题" : "");
    expect(setNavigationBarTitle).toHaveBeenLastCalledWith({ title: scenario === "new title" ? "更新后的标题" : "发现首页" });
  });
});
