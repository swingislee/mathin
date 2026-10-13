import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as experience from "../contracts/participant-api/miniapp-experience";
import { defaultExperienceForm } from "../contracts/participant-api/miniapp-experience-templates";

type FormPage = {
  data: { busy: boolean; pending: object | null; serviceId: string; form: unknown; loading: boolean; error: string; participants: { id: string }[]; selectedIds: string[]; selectedIndex: number; detail: { flow: { allowMultipleParticipants: boolean } } | null };
  setData: (patch: object) => void; load: () => Promise<void>; participant: (e: { detail: { value: number | string[] } }) => void;
};
function runtime(multiple = false, pending: object | string = "") {
  let page!: FormPage;
  const wx = { getStorageSync: vi.fn(() => pending), removeStorageSync: vi.fn() };
  const api = { ApiError: Error, session: () => ({}), get: async () => ({ id: "account", participants: [{ id: "one" }, { id: "two" }] }), experienceRequest: async () => [], experienceRead: async () => ({ revision: 1, form: defaultExperienceForm(), flow: { allowMultipleParticipants: multiple, consentDocumentIds: [] } }) };
  const code = ts.transpileModule(readFileSync("apps/parent-wechat/miniprogram/pages/experience-form/index.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports: {}, wx, require: (name: string) => {
    if (name.endsWith("/native-page")) return { configuredPage: () => (definition: FormPage) => { page = definition; page.setData = patch => Object.assign(page.data, patch); } };
    if (name.endsWith("/api")) return api;
    if (name.endsWith("/miniapp-experience")) return experience;
    if (name.endsWith("/page")) return { pageData: () => ({}), currentLocale: () => "zh", errorText: () => "error" };
    return {};
  } });
  page.data.serviceId = "service";
  return page;
}

describe("service form participant selection", () => {
  it("opens with WeChat's empty-string cache value and replaces the participant in a single-person flow", async () => {
    const page = runtime(); await page.load();
    expect(page.data.error).toBe(""); expect(page.data.form).toBeTruthy(); expect(page.data.selectedIndex).toBe(-1);
    page.participant({ detail: { value: 0 } }); expect(page.data.selectedIds).toEqual(["one"]);
    page.participant({ detail: { value: 1 } }); expect(page.data.selectedIds).toEqual(["two"]); expect(page.data.selectedIndex).toBe(1);
    expect(readFileSync("apps/parent-wechat/miniprogram/pages/experience-form/index.wxml", "utf8")).toContain('multiple="{{detail.flow.allowMultipleParticipants}}"');
  });
  it("keeps supported multi-person choices and ignores changes during submission", async () => {
    const page = runtime(true); await page.load();
    page.participant({ detail: { value: ["one", "unknown", "two"] } }); expect(page.data.selectedIds).toEqual(["one", "two"]);
    page.data.busy = true; page.participant({ detail: { value: [] } }); expect(page.data.selectedIds).toEqual(["one", "two"]);
  });
  it("restores the selected participant while an uncertain submission awaits retry", async () => {
    const page = runtime(false, { id: "pending", action: "submit", participantIds: ["two"], answers: {} }); await page.load();
    expect(page.data.selectedIndex).toBe(1); expect(page.data.selectedIds).toEqual(["two"]);
    page.participant({ detail: { value: 0 } }); expect(page.data.selectedIds).toEqual(["two"]);
  });
});
