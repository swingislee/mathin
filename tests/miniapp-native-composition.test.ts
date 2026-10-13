import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nativeScreenConfig, nativeScreenDefault, nativeScreenIds, nativeScreens, type NativeScreenConfig } from "../contracts/participant-api/miniapp-native";
import { defaultMiniappExperience, newContentBlock } from "../contracts/participant-api/miniapp-experience-templates";
import { defaultMiniappSettings } from "../contracts/participant-api/miniapp-settings";
import { miniappExperienceSchema } from "../src/features/school/miniapp-settings/experience-schema";
import { experienceIssues } from "../contracts/participant-api/miniapp-experience-validation";
import { renderContent } from "../contracts/participant-api/miniapp-content-render";
import { clearNavigation, openPage, requestLogin, resumeAfterLogin } from "../apps/parent-wechat/miniprogram/lib/navigation";

describe("native composition contract", () => {
  it("covers actual registered pages and preserves configurations created before screen customization", () => {
    const app = JSON.parse(readFileSync("apps/parent-wechat/miniprogram/app.json", "utf8"));
    expect([...nativeScreenIds].map(id => `pages/${id}/index`).sort()).toEqual([...app.pages].sort());
    const old = defaultMiniappExperience(defaultMiniappSettings());
    delete old.screens;
    expect(miniappExperienceSchema.safeParse(old).success).toBe(true);
    const value = { ...old, screens: nativeScreens.filter(s => !s.redirect).map(s => nativeScreenDefault(s.id)) };
    expect(miniappExperienceSchema.safeParse(JSON.parse(JSON.stringify(value))).success).toBe(true);
    for (const id of nativeScreenIds) expect(nativeScreenConfig(undefined, id)).toEqual(nativeScreenDefault(id));
  });

  it("rejects unsupported modules, hidden transaction steps and duplicate IDs", () => {
    const base = defaultMiniappExperience(defaultMiniappSettings());
    const screen = nativeScreenDefault("provider-booking");
    const valid = (screens: NativeScreenConfig[]) => miniappExperienceSchema.safeParse({ ...base, screens }).success;
    expect(valid([{ ...screen, modules: [{ ...screen.modules[0], id: "executeScript" }] }])).toBe(false);
    expect(valid([{ ...screen, modules: [{ ...screen.modules[0], visible: false }] }])).toBe(false);
    expect(valid([{ ...screen, modules: [{ ...screen.modules[0], density: "compact" }] }])).toBe(false);
    expect(valid([screen, screen])).toBe(false);
    expect(valid([{ ...screen, modules: [screen.modules[0], screen.modules[0]] }])).toBe(false);
    expect(valid([{ ...screen, tabLabel: { zh: "多余", en: "Unused" } }])).toBe(false);
  });

  it("reorders presentation siblings while keeping identity and required steps intact", () => {
    const screen = nativeScreenDefault("account");
    const ordered = [...screen.modules].reverse().map(m => ({ ...m, visible: false }));
    const resolved = nativeScreenConfig([{ ...screen, modules: ordered }], "account");
    expect(resolved.modules.map(m => m.id)).toEqual(["identity", "menu", "shortcuts", "participants"]);
    expect(resolved.modules.find(m => m.id === "identity")?.visible).toBe(true);
    expect(resolved.modules.find(m => m.id === "participants")?.visible).toBe(true);
    expect(resolved.modules.find(m => m.id === "menu")?.visible).toBe(false);
  });

  it("keeps supplemental content public and live personal records out of frozen report layouts", () => {
    const value = defaultMiniappExperience(defaultMiniappSettings());
    const page = value.pages.find(p => p.purpose !== "report")!;
    page.audience = "signedIn";
    value.screens = [{ ...nativeScreenDefault("calendar"), beforePageId: page.id }];
    expect(experienceIssues(value).some(i => i.code === "PUBLIC_SCREEN_CONTENT")).toBe(true);
    const report = value.pages.find(p => p.purpose === "report")!;
    report.blocks.push(newContentBlock("accountRecords", "live"));
    expect(experienceIssues(value).some(i => i.code === "LIVE_RECORDS_IN_REPORT")).toBe(true);
    page.audience = "all"; report.blocks.pop();
    page.blocks = [newContentBlock("accountRecords", "personal-records")];
    expect(experienceIssues(value)).toEqual([]);
    const rendered = renderContent(page, {}, "zh")[0];
    expect(rendered.recordSource).toBe("serviceBookings");
    expect(rendered.limit).toBe(3);
    expect(rendered.items).toEqual([]);
  });
});

describe("native routes and login returns", () => {
  const navigateTo = vi.fn(), switchTab = vi.fn();
  beforeEach(() => { clearNavigation(); navigateTo.mockClear(); switchTab.mockClear(); vi.stubGlobal("wx", { navigateTo, switchTab }); });
  afterEach(() => vi.unstubAllGlobals());
  it("opens and resumes every registered route using the same destination contract", () => {
    for (const id of nativeScreenIds) {
      const tab = ["discover", "calendar", "account"].includes(id), url = `/pages/${id}/index` + (tab ? "" : "?id=stable-id");
      openPage(url);
      expect(tab ? switchTab : navigateTo).toHaveBeenLastCalledWith({ url });
      requestLogin(url);
      expect(resumeAfterLogin()).toBe(true);
      expect(tab ? switchTab : navigateTo).toHaveBeenLastCalledWith({ url });
      expect(resumeAfterLogin()).toBe(false);
    }
  });
  it("rejects external, unknown and query-bearing tab destinations", () => {
    for (const url of ["https://example.com", "/pages/unknown/index", "/pages/experience/index#fragment", "/pages/account/index?id=unsafe", "/pages/../experience/index"]) {
      openPage(url); requestLogin(url); expect(resumeAfterLogin()).toBe(false);
    }
    expect(navigateTo).not.toHaveBeenCalled(); expect(switchTab).not.toHaveBeenCalled();
  });
});
