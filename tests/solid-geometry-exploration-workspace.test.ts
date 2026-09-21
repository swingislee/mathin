// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidGeometryExplorationWorkspace } from "@/features/tools/solid-geometry/SolidGeometryExplorationWorkspace";
import type { SolidGeometryCanvasProps } from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { arrangeSolidCut, createSolidCut, createSolidGeometryExplorationInitial, solidCutPieceId, solidGeometryExplorationSnapshot, type SolidGeometryExplorationInitial, type SolidGeometryExplorationSnapshot } from "@/features/tools/solid-geometry/exploration-contract";
import { solidGeometryMessages } from "@/features/tools/solid-geometry/solid-geometry-messages";
import { solidSectionsMessages } from "@/features/tools/solid-sections/solid-sections-messages";
import { measurementMessages } from "@/features/tools/solid-measurement/measurement-messages";

const canvas = vi.hoisted(() => ({ props: null as SolidGeometryCanvasProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SolidGeometryCanvasProps) { canvas.props = props; return null; } }));
let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, serial: number;
const m = solidGeometryMessages("en"), section = solidSectionsMessages("en"), measure = measurementMessages("en");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  now = 1000; frames = new Map(); serial = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element: ReactElement) { await act(async () => root.render(createElement(StrictMode, null, element))); }
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label); expect(button, label).toBeDefined(); await act(async () => button!.click()); }
async function advance(ms = 800) { for (let elapsed = 0; elapsed <= ms; elapsed += 16) { now += 16; const pending = [...frames.values()]; frames.clear(); await act(async () => pending.forEach((frame) => frame(now))); } }
function cutInitial(): SolidGeometryExplorationInitial {
  const initial = createSolidGeometryExplorationInitial(), entity = initial.entities[0], cut = createSolidCut(entity, { normal: { x: 0, y: 1, z: 0 }, distance: 0 })!;
  return { ...initial, cuts: [cut], selectedId: solidCutPieceId(cut, 0) };
}

describe("one shared geometry stage for units and closed cut pieces", () => {
  it("cuts using the current plane, separates continuously, moves either piece, reassembles and restores", async () => {
    const capture = vi.fn(); await render(createElement(SolidGeometryExplorationWorkspace, { onSnapshot: capture }));
    expect(container.querySelector('[data-solid-geometry-workspace="v2"]')).not.toBeNull();
    await click(section.title); await advance(); await click("Cut into two pieces"); await advance();
    let prepared = capture.mock.lastCall![0] as SolidGeometryExplorationInitial;
    expect(prepared.cuts).toHaveLength(1); expect(canvas.props!.entities).toHaveLength(2); expect(canvas.props!.meshes?.size).toBe(2);
    expect(canvas.props!.objectManipulation).toBe(true); expect(container.querySelector("[data-solid-cut-controls]")).not.toBeNull();
    const originalPose = canvas.props!.entities.map((e) => e.position);
    await click("Separate pieces"); expect(capture.mock.lastCall![0]).toBeNull(); await advance(200);
    expect(canvas.props!.entities[0].position).not.toEqual(originalPose[0]); expect(canvas.props!.objectAnimating).toBe(true);
    await advance(); prepared = capture.mock.lastCall![0]; expect(prepared.entities[0].position).toEqual({ x: 0, y: 1, z: 0 });
    const second = canvas.props!.entities[1], moved = { ...second, position: { x: 2.31, y: second.position.y, z: -0.42 }, rotation: { x: Math.PI / 2, y: 0, z: 0 } };
    await act(async () => { expect(canvas.props!.onTransform!(moved)).toBe(true); });
    expect(canvas.props!.selectedId).toBe(second.id); expect(canvas.props!.entities[1].position).toEqual(moved.position); expect(canvas.props!.objectAnimating).toBe(false);
    await advance(100); expect(canvas.props!.entities[1].position).toEqual(moved.position);
    await click("Reassemble"); await advance(); expect(canvas.props!.entities.map((e) => e.position)).toEqual(originalPose);
    expect(canvas.props!.entities[1].rotation).toEqual({ x: 0, y: 0, z: 0 });
    await click("Remove cut"); await advance(); expect(canvas.props!.entities).toHaveLength(1); expect((capture.mock.lastCall![0] as SolidGeometryExplorationInitial).cuts).toEqual([]);
    await click(m.reset); await advance(); expect(capture.mock.lastCall![0]).toEqual(createSolidGeometryExplorationInitial());
  });
  it("keeps blank/Escape selection local and protects read-only cut scenes", async () => {
    const initial = cutInitial(), state = solidGeometryExplorationSnapshot(initial), publish = vi.fn(async () => {});
    await render(createElement(SolidGeometryExplorationWorkspace, { initial, classroom: { state, onChange: publish } }));
    await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(canvas.props!.selectionActive).toBe(false); expect(publish).not.toHaveBeenCalled();
    expect(canvas.props!.state.entities).toHaveLength(2);
    await act(async () => container.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(publish).not.toHaveBeenCalled();
    await render(createElement(SolidGeometryExplorationWorkspace, { key: "readonly", initial, classroom: { state } }));
    expect(canvas.props!.readOnly).toBe(true); expect(canvas.props!.onPointerMissed).toBeUndefined();
    expect([...container.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.closest('[role="toolbar"]')).every((button) => button.disabled)).toBe(true);
    const altered = { ...canvas.props!.entities[0], position: { x: 3, y: 2, z: 0 } };
    await act(async () => expect(canvas.props!.onTransform!(altered)).toBe(false));
  });
  it("commits a direct cut-piece drag once and never replays it on classroom acknowledgement", async () => {
    const initial = cutInitial(), origin = solidGeometryExplorationSnapshot(initial), sent: SolidGeometryExplorationSnapshot[] = [];
    let accept!: () => void; const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Harness() { const [state, setState] = useState(origin); return createElement(SolidGeometryExplorationWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness));
    const entity = canvas.props!.entities[1], moved = { ...entity, position: { ...entity.position, x: 1.43, z: 2.17 } };
    await act(async () => expect(canvas.props!.onTransform!(moved)).toBe(true));
    expect(sent).toHaveLength(1); expect(sent[0].cuts[0].pieces[1].position).toEqual(moved.position);
    expect(canvas.props!.entities[1].position).toEqual(moved.position); expect(canvas.props!.readOnly).toBe(true);
    await advance(100); await act(async () => accept()); await advance(100);
    expect(canvas.props!.entities[1].position).toEqual(moved.position); expect(canvas.props!.objectAnimating).toBe(false); expect(sent).toHaveLength(1);
    await render(createElement(SolidGeometryExplorationWorkspace, { key: "late", initial, classroom: { state: sent[0] } }));
    expect(canvas.props!.entities[1].position).toEqual(moved.position); expect(canvas.props!.objectAnimating).toBe(false);
  });
  it("changes true unit conversion without resizing, then builds a 10×10×10 physical-unit example", async () => {
    const capture = vi.fn(); await render(createElement(SolidGeometryExplorationWorkspace, { onSnapshot: capture }));
    await click(measure.title); await advance(); const original = canvas.props!.state.entities[0];
    await click("dm"); await advance();
    expect(canvas.props!.state.entities[0]).toEqual(original); expect(container.textContent).toContain("0.012 dm³");
    await click("Along an edge"); await advance(); await click("Add one unit"); await advance();
    expect((capture.mock.lastCall![0] as SolidGeometryExplorationInitial).measurement.accumulationCount).toBe(1);
    await click("Cover one layer"); await click("Accumulate all"); await advance();
    expect((capture.mock.lastCall![0] as SolidGeometryExplorationInitial).measurement.accumulationCount).toBe(6);
    await click("Explore 1 dm³ = 1,000 cm³"); await advance();
    expect(canvas.props!.state.entities[0].dimensions).toEqual({ width: 10, height: 10, depth: 10, radius: 1 });
    await click("Accumulate all"); await advance();
    expect((capture.mock.lastCall![0] as SolidGeometryExplorationInitial).measurement.accumulationCount).toBe(1000);
    expect(container.textContent).toContain("1 dm³");
    await click(m.reset); await advance(); expect(capture.mock.lastCall![0]).toEqual(createSolidGeometryExplorationInitial());
  });
  it("late joining a separated prepared scene does not replay its initial arrangement", async () => {
    const initial = cutInitial(); initial.cuts[0] = arrangeSolidCut(initial.cuts[0], initial.entities[0], true);
    await render(createElement(SolidGeometryExplorationWorkspace, { initial })); expect(canvas.props!.objectAnimating).toBe(false);
    expect(canvas.props!.entities[0].position).toEqual(initial.cuts[0].pieces[0].position);
  });
});
