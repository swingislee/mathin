// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidRevolutionWorkspace, type SolidRevolutionWorkspaceProps } from "@/features/tools/solid-revolution/SolidRevolutionWorkspace";
import type { SolidRevolutionCanvasProps } from "@/features/tools/solid-revolution/SolidRevolutionCanvas";
import { createDefaultSolidRevolutionInitial, solidRevolutionSnapshot, type SolidRevolutionSnapshot } from "@/features/tools/solid-revolution/contract";
import { resumeRevolution } from "@/features/tools/solid-revolution/model";

const viewport = vi.hoisted(() => ({ current: null as SolidRevolutionCanvasProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function Viewport(props: SolidRevolutionCanvasProps) { viewport.current = props; return null; } }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
let root: Root, host: HTMLDivElement, serial = 0, now = 1000;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  frames.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = async (props: SolidRevolutionWorkspaceProps = {}) => act(async () => root.render(createElement(SolidRevolutionWorkspace, props)));
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found, label).toBeDefined(); return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function tick(time: number) { now = time; const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(time))); }

describe("revolution teaching workspace", () => {
  it("switches shapes and original edges in the common panel and restores its prepared start", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    expect(capture.mock.lastCall![0]).toEqual(createDefaultSolidRevolutionInitial());
    await click("Paper & rotation axis"); await click("Right triangle"); await click("Edge A");
    expect(viewport.current!.snapshot).toMatchObject({ shape: "right-triangle", axis: "width", angle: 0 });
    await click("Restore prepared start");
    expect(capture.mock.lastCall![0]).toEqual(createDefaultSolidRevolutionInitial());
    expect(host.querySelector("[data-cube-canvas-panel]")).toBeNull();
  });
  it("plays, pauses, resumes, reverses and captures exactly the visible paused angle", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    await click("Turn once / resume"); await tick(1000); await tick(4000);
    expect(viewport.current!.angle).toBe(90); expect(capture.mock.lastCall![0]).toBeNull();
    expect(viewport.current!.interactive).toBe(true); expect(viewport.current!.gestureEnabled).toBe(false);
    await click("Pause rotation"); expect(viewport.current!.snapshot.angle).toBe(90); expect(viewport.current!.snapshot.motion).toBeNull();
    expect(capture.mock.lastCall![0].angle).toBe(90);
    now = 7000; await click("Turn once / resume"); await tick(10000);
    expect(viewport.current!.angle).toBe(180);
    await tick(16000); expect(viewport.current!.angle).toBe(360); expect(capture.mock.lastCall![0].angle).toBe(360);
    await click("Return to flat paper"); await tick(16000); await tick(16325);
    expect(viewport.current!.angle).toBe(180); await tick(16650); expect(viewport.current!.angle).toBe(0);
  });
  it("updates display and camera without restarting the current revolution", async () => {
    await render(); await click("Turn once / resume"); await tick(4000);
    const command = viewport.current!.snapshot.motion;
    await click("Keep swept solid"); await click("Top view");
    expect(viewport.current!.snapshot.motion).toEqual(command); expect(viewport.current!.snapshot.showSweep).toBe(false);
    await tick(7000); expect(viewport.current!.angle).toBe(180);
  });
  it("keeps manual preview out of saved scenes, commits once, and never replays the completed gesture", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    await act(async () => { viewport.current!.onDragging(true); viewport.current!.onPreview(137); });
    expect(viewport.current!.angle).toBe(137); expect(capture.mock.lastCall![0]).toBeNull();
    await act(async () => { viewport.current!.onCommit(137); viewport.current!.onPreview(null); viewport.current!.onDragging(false); });
    expect(viewport.current!.angle).toBe(137); expect(viewport.current!.snapshot.motion).toBeNull(); expect(capture.mock.lastCall![0].angle).toBe(137);
    await tick(6000); expect(viewport.current!.angle).toBe(137); expect(frames.size).toBe(0);
  });
  it("classroom motion starts only from the authority, preserves late-join progress, and emits no animation frames", async () => {
    const initial = createDefaultSolidRevolutionInitial(), state = solidRevolutionSnapshot(initial);
    const update = vi.fn(async (next: SolidRevolutionSnapshot) => { void next; });
    await render({ initial, classroom: { state, onChange: update } });
    await click("Turn once / resume"); expect(update).toHaveBeenCalledTimes(1); expect(viewport.current!.angle).toBe(0);
    const command = update.mock.calls[0][0]; now = 4000;
    await render({ initial, classroom: { state: command, onChange: update } }); await tick(4000);
    expect(viewport.current!.angle).toBe(90);
    now = 7000; await render({ initial, classroom: { state: structuredClone(command), onChange: update } }); await tick(7000);
    expect(viewport.current!.angle).toBe(180); expect(update).toHaveBeenCalledTimes(1);
    await click("Pause rotation"); expect(update.mock.lastCall![0]).toMatchObject({ angle: 180, motion: null });
  });
  it("holds a manual classroom endpoint until acknowledgement without replaying it, then falls back on failure", async () => {
    const initial = createDefaultSolidRevolutionInitial(), state = solidRevolutionSnapshot(initial);
    let reject!: (reason: unknown) => void;
    const update = vi.fn((next: SolidRevolutionSnapshot) => new Promise<void>((_resolve, failed) => { void next; reject = failed; }));
    await render({ initial, classroom: { state, onChange: update } });
    await act(async () => { viewport.current!.onCommit(75); }); expect(viewport.current!.angle).toBe(75);
    expect(update).toHaveBeenCalledTimes(1); expect(update.mock.calls[0][0]).toMatchObject({ angle: 75, motion: null });
    await act(async () => reject(new Error("save")));
    expect(viewport.current!.angle).toBe(0); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("keeps showcase and late-join clients read-only while resolving the same motion time", async () => {
    const initial = createDefaultSolidRevolutionInitial(), playing = resumeRevolution(solidRevolutionSnapshot(initial), 1000);
    now = 7000; await render({ initial, classroom: { state: playing } });
    expect(viewport.current!.angle).toBe(180); expect(viewport.current!.interactive).toBe(false); expect(viewport.current!.gestureEnabled).toBe(false);
    expect(button("Pause rotation").disabled).toBe(true);
    await tick(13000); expect(viewport.current!.angle).toBe(360);
  });
  it("uses shared empty-space deselection without changing the prepared mathematical state", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture }); const state = viewport.current!.snapshot;
    await click("Rotation controls");
    await act(async () => viewport.current!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(viewport.current!.selected).toBe(false); expect(viewport.current!.snapshot).toBe(state);
    expect(host.querySelector("[data-cube-canvas-panel]")).toBeNull();
    await act(async () => viewport.current!.onSelect()); expect(viewport.current!.selected).toBe(true);
  });
});
