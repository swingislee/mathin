// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import DiceWorkspace from "@/features/tools/spatial-lab/DiceTeachingWorkspace";
import { CubeNetFoldWorkspace } from "@/features/tools/spatial-lab/CubeNetFoldWorkspace";
import { cubeNetTeachingSnapshotSchema, diceTeachingSnapshotSchema } from "@/features/tools/courseware/spatial-teaching-content";
import { buildNet, diceTool, netTool } from "./fixtures/spatial-teaching-content";

const canvases = vi.hoisted(() => ({ dice: null as null | { onDraggingChange: (value: boolean) => void; selectedId: string }, net: false }));
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => {
  const dice = String(loader).includes("DiceTeachingCanvas");
  return function CanvasStub(props: NonNullable<typeof canvases.dice>) { if (dice) canvases.dice = props; else canvases.net = true; return null; };
} }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); canvases.dice = null; canvases.net = false; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(child: ReturnType<typeof createElement>) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => { root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: child })); });
}
describe("shared workbench courseware adapters", () => {
  it("exports the dice starting scene without a capture loop and waits for the existing drag preview", async () => {
    const initial = diceTool().payload.initial, capture = vi.fn();
    await mount(createElement(DiceWorkspace, { locale: "en", initial, onSnapshot: capture, courseware: true }));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(diceTeachingSnapshotSchema.parse(capture.mock.lastCall![0])).toEqual(initial);
    await act(async () => canvases.dice!.onDraggingChange(true));
    expect(capture.mock.lastCall![0]).toBeNull();
    await act(async () => canvases.dice!.onDraggingChange(false));
    expect(capture.mock.lastCall![0]).toEqual(initial);
    expect(host.querySelector('[data-workbench-mode="courseware"]')).not.toBeNull();
  });
  it("initializes frozen dice selection and applies read-only to the complete original workbench", async () => {
    const initial = diceTool().payload.initial;
    initial.arrows = true; initial.view = "bottom";
    await mount(createElement(DiceWorkspace, { locale: "en", initial, courseware: true, readOnly: true }));
    expect(host.querySelector('[data-dice-teaching][inert]')).not.toBeNull();
    expect(canvases.dice!.selectedId).toBe(initial.selectedId);
  });
  it("rehydrates the original net workbench and exports only the versioned starting snapshot", async () => {
    const initial = netTool(await buildNet()).payload.initial, capture = vi.fn();
    initial.angles[Object.keys(initial.angles)[0]] = 53;
    await mount(createElement(CubeNetFoldWorkspace, { locale: "en", initial, onSnapshot: capture, readOnly: true, courseware: true }));
    await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(canvases.net, host.textContent ?? "").toBe(true); });
    expect(canvases.net).toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(cubeNetTeachingSnapshotSchema.parse(capture.mock.lastCall![0])).toEqual(initial);
    expect(host.querySelector('[data-cube-net-teaching][inert][data-workbench-mode="courseware"]')).not.toBeNull();
  });
});
