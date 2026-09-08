// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { AutomaticLectureAdaptation } from "@/features/courseware-studio/AutomaticLectureAdaptation";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), refresh: vi.fn() }));
const router = { refresh: mocks.refresh };
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/courseware-studio/automatic-adaptation-actions", () => ({ prepareLectureAdaptedDraftsAction: mocks.prepare }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(missingCount: number, strict = false) {
  // eslint-disable-next-line react/no-children-prop
  const gate = createElement(AutomaticLectureAdaptation, { lectureId: "lecture", missingCount, children: createElement("div", { "data-editor": true }, "Editor") });
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: strict ? createElement(StrictMode, null, gate) : gate })));
}
describe("automatic preparation before manual editing", () => {
  it("automatically runs every batch without page clicks and waits for fresh server props before mounting editors", async () => {
    mocks.prepare.mockResolvedValueOnce({ ok: true, data: { created: 8, remaining: 2 } }).mockResolvedValueOnce({ ok: true, data: { created: 2, remaining: 0 } });
    await mount(10);
    expect(mocks.prepare).toHaveBeenCalledTimes(2); expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-editor]")).toBeNull();
    await mount(0); expect(host.querySelector("[data-editor]")).not.toBeNull();
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });
  it("can resume after a failure without exposing an editor that a refresh would discard", async () => {
    mocks.prepare.mockResolvedValueOnce({ ok: false, code: "VERSION_CONFLICT" });
    await mount(3); expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector("[data-editor]")).toBeNull();
    mocks.prepare.mockResolvedValue({ ok: true, data: { created: 3, remaining: 0 } });
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("finishes under Strict Mode effect replays and does nothing for a complete lecture", async () => {
    mocks.prepare.mockResolvedValue({ ok: true, data: { created: 0, remaining: 0 } });
    await mount(2, true); expect(mocks.refresh).toHaveBeenCalledOnce();
    await mount(0, true); expect(host.querySelector("[data-editor]")).not.toBeNull();
  });
});
