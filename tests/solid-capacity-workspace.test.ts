// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidCapacityWorkspace } from "@/features/tools/solid-capacity/SolidCapacityWorkspace";
import type { SolidGeometryCanvasProps } from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { createDefaultSolidCapacityInitial, solidCapacitySnapshot, type SolidCapacitySnapshot } from "@/features/tools/solid-capacity/solid-capacity-contract";
import { solidCapacityMessages } from "@/features/tools/solid-capacity/solid-capacity-messages";

const canvas = vi.hoisted(() => ({ props: null as SolidGeometryCanvasProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/features/tools/solid-capacity/SolidCapacityLiquids", () => ({ SolidCapacityLiquids: () => null }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SolidGeometryCanvasProps) { canvas.props = props; return null; } }));
let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
const m = solidCapacityMessages("en");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); now = 1000; frames = new Map(); nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element: ReactElement) { await act(async () => root.render(createElement(StrictMode, null, element))); }
async function click(label: string) { const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); expect(button).not.toBeNull(); await act(async () => button!.click()); }
async function textClick(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function advance(ms = 1300) { now += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const frame of pending) frame(now); }); }
function liquidProps() { return (canvas.props!.renderScene!({ entities: [], selected: null }) as ReactElement<{ frame: { cone: { fill: number }; cylinder: { fill: number } } }>).props; }

describe("capacity teacher workspace", () => {
  it("uses the shared stage and floating toolbar, animates each pour, and restores the prepared origin", async () => {
    const initial = createDefaultSolidCapacityInitial(), capture = vi.fn();
    await render(createElement(SolidCapacityWorkspace, { initial, onSnapshot: capture })); expect(capture.mock.lastCall![0]).toEqual(initial);
    expect(container.querySelector(`[aria-label="${m.liquid}"]`)?.closest("[data-capacity-tools-toolbar]")).not.toBeNull();
    await click(m.liquid); expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    for (let turn = 1; turn <= 3; turn++) {
      if (turn > 1) { await textClick(m.fillCone); await advance(); }
      await textClick(m.pourCone); expect(capture.mock.lastCall![0]).toBeNull(); await advance(600);
      expect(liquidProps().frame.cone.fill).toBeGreaterThan(0); expect(liquidProps().frame.cone.fill).toBeLessThan(1);
      expect(canvas.props!.readOnly).toBe(false); await advance();
      expect(capture.mock.lastCall![0].cylinder.fill).toBeCloseTo(turn / 3);
    }
    await click(m.reset); await advance(); expect(capture.mock.lastCall![0]).toEqual(initial); expect(canvas.props!.cameraRevision).toBe(1);
  });
  it("allows independent dimensions without asserting 1:3, clears liquids on resize, and keeps labels optional", async () => {
    const capture = vi.fn(); await render(createElement(SolidCapacityWorkspace, { onSnapshot: capture }));
    expect(container.textContent).not.toContain(m.ratio); await click(m.numbers); expect(container.textContent).toContain(m.ratio);
    await click(m.dimensions); await textClick(m.independent);
    const input = container.querySelector<HTMLInputElement>("#capacity-cylinder-radius")!;
    await act(async () => { input.value = "2"; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await advance();
    expect(capture.mock.lastCall![0].cylinder.radius).toBe(2); expect(capture.mock.lastCall![0].cone.fill).toBe(0);
    expect(container.textContent).toContain(m.ratioDifferent); expect(container.textContent).not.toContain(m.ratio);
    await click(m.settings); await textClick(m.tipUp); await advance(); expect(capture.mock.lastCall![0].coneOrientation).toBe("tip-up");
  });
});
describe("capacity common classroom writer", () => {
  it("waits for authoritative acceptance, animates once, and publishes one endpoint", async () => {
    const initial = createDefaultSolidCapacityInitial(); let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; }), sent: SolidCapacitySnapshot[] = [];
    function Harness() { const [state, setState] = useState(solidCapacitySnapshot(initial)); return createElement(SolidCapacityWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness)); await click(m.liquid); await textClick(m.pourCone);
    expect(sent).toHaveLength(1); expect(liquidProps().frame.cone.fill).toBe(1); await textClick(m.pourCone); expect(sent).toHaveLength(1);
    await act(async () => accept()); await advance(600); expect(liquidProps().frame.cone.fill).toBeCloseTo(0.5);
    await advance(); expect(liquidProps().frame.cone.fill).toBe(0); expect(liquidProps().frame.cylinder.fill).toBeCloseTo(1 / 3);
    await click(m.numbers); await advance(50); expect(liquidProps().frame.cone.fill).toBe(0); expect(sent).toHaveLength(2);
  });
  it("retains confirmed state on failure and restores late viewers without draft reads", async () => {
    const initial = createDefaultSolidCapacityInitial(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await render(createElement(SolidCapacityWorkspace, { initial, classroom: { state: solidCapacitySnapshot(initial), onChange: async () => { throw new Error("offline"); } } }));
    await click(m.liquid); await textClick(m.pourCone); expect(container.querySelector('[role="alert"]')?.textContent).toBe(m.syncError); expect(liquidProps().frame.cone.fill).toBe(1);
    const state = { ...solidCapacitySnapshot(initial), cylinder: { ...initial.cylinder, fill: 2 / 3 }, cone: { ...initial.cone, fill: 0 }, view: "bottom" as const };
    await render(createElement(SolidCapacityWorkspace, { key: "viewer", initial, classroom: { state } }));
    expect(liquidProps().frame.cylinder.fill).toBeCloseTo(2 / 3); expect(canvas.props!.state.view).toBe("bottom"); expect(canvas.props!.readOnly).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-capacity-tools-toolbar] button")].every((button) => button.disabled)).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
});
