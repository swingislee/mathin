import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegistrationLocation } from "../contracts/participant-api/onboarding";

type LocationApi = { beginEntryLocation: (scene: string) => Promise<RegistrationLocation>;
  entryLocation: (scene?: string) => Promise<RegistrationLocation>; clearEntryLocation: () => void };
function runtime(overrides: Record<string, unknown> = {}) {
  const wx = { getSetting: vi.fn(async () => ({ authSetting: { "scope.userLocation": true } })),
    requirePrivacyAuthorize: vi.fn(async () => undefined), getLocation: vi.fn(async () => ({ latitude: 30, longitude: 120, accuracy: 8 })), ...overrides };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("apps/parent-wechat/miniprogram/lib/entry-location.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText,
  { exports, wx, Date, setTimeout, clearTimeout });
  return { api: exports as LocationApi, wx };
}
afterEach(() => vi.useRealTimers());
describe("location at Mini Program entry", () => {
  it("captures once on entry and reuses that sample when the form is submitted later", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T02:00:00.000Z"));
    const run = runtime();
    const captured = await run.api.beginEntryLocation("scene-a");
    vi.setSystemTime(new Date("2026-10-09T02:10:00.000Z"));
    expect(await run.api.entryLocation("scene-a")).toEqual(captured);
    expect(captured).toMatchObject({ status: "granted", enteredAt: "2026-10-09T02:00:00.000Z", capturedAt: "2026-10-09T02:00:00.000Z" });
    expect(run.wx.getLocation).toHaveBeenCalledTimes(1);
  });
  it("honors a previously declined permission without prompting again", async () => {
    const run = runtime({ getSetting: async () => ({ authSetting: { "scope.userLocation": false } }) });
    expect(await run.api.beginEntryLocation("scene-a")).toMatchObject({ status: "declined" });
    expect(run.wx.getLocation).not.toHaveBeenCalled(); expect(run.wx.requirePrivacyAuthorize).not.toHaveBeenCalled();
  });
  it("does not keep waiting or locate after a long authorization delay", async () => {
    vi.useFakeTimers(); let authorize!: () => void;
    const run = runtime({ requirePrivacyAuthorize: () => new Promise<void>(resolve => { authorize = resolve; }) });
    const result = run.api.beginEntryLocation("scene-a");
    await vi.advanceTimersByTimeAsync(15000);
    expect(await result).toMatchObject({ status: "unavailable" });
    authorize(); await Promise.resolve();
    expect(run.wx.getLocation).not.toHaveBeenCalled();
  });
  it("takes a fresh sample for a new scan and does not persist coordinates", async () => {
    const run = runtime();
    await run.api.beginEntryLocation("scene-a");
    await run.api.beginEntryLocation("scene-b");
    await run.api.entryLocation("scene-b");
    expect(run.wx.getLocation).toHaveBeenCalledTimes(2);
    run.api.clearEntryLocation(); await run.api.entryLocation("scene-b");
    expect(run.wx.getLocation).toHaveBeenCalledTimes(3);
  });
});
