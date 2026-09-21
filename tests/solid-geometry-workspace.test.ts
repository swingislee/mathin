// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidGeometryWorkspace } from "@/features/tools/solid-geometry/SolidGeometryWorkspace";
import type { SolidGeometryCanvasProps } from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { createSolidEntity, createSolidGeometryInitial, solidGeometrySnapshot, type SolidGeometrySnapshot } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { solidGeometryMessages } from "@/features/tools/solid-geometry/solid-geometry-messages";
import { measurementMessages } from "@/features/tools/solid-measurement/measurement-messages";
import { solidSectionsMessages } from "@/features/tools/solid-sections/solid-sections-messages";
import { SOLID_TRANSITION_MS } from "@/features/tools/solid-geometry/solid-geometry-motion";
import { spatialActionMessages } from "@/features/tools/spatial-interaction/messages";

const canvas = vi.hoisted(() => ({ props: null as SolidGeometryCanvasProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SolidGeometryCanvasProps) {
  canvas.props = props;
  return createElement("button", { "data-solid-hit": true, onClick: () => props.onPick?.(props.state.entities[0].id, { entityId: props.state.entities[0].id, kind: "face", id: "front" }) }, "Synthetic face hit");
} }));
let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
const m = solidGeometryMessages("en");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  now = 1000; frames = new Map(); nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element: ReactElement) { await act(async () => root.render(createElement(StrictMode, null, element))); }
async function click(label: string) { const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`); expect(button).not.toBeNull(); await act(async () => button!.click()); }
async function textClick(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function advance(ms = SOLID_TRANSITION_MS + 80) { for (let elapsed = 0; elapsed <= ms; elapsed += 16) {
  now += 16; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const frame of pending) frame(now); });
} }

describe("solid geometry teacher workspace", () => {
  it("deselects locally without removing the section or measurement teaching state", async () => {
    const initial = createSolidGeometryInitial(), onChange = vi.fn(async () => {}); initial.section.enabled = true;
    const snapshot = solidGeometrySnapshot(initial);
    await render(createElement(SolidGeometryWorkspace, { initial, classroom: { state: snapshot, onChange } }));
    await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(canvas.props!.selectionActive).toBe(false); expect(canvas.props!.sectionEditable).toBe(false);
    expect(canvas.props!.state).toBe(snapshot); expect(canvas.props!.state.section.enabled).toBe(true); expect(onChange).not.toHaveBeenCalled();
    await act(async () => canvas.props!.onPick!(initial.selectedId!, null));
    expect(canvas.props!.selectionActive).toBe(true);
  });
  it("exits specialist picking on panel close, repeat activation and switching to another panel", async () => {
    await render(createElement(SolidGeometryWorkspace));
    await click(m.face); expect(canvas.props!.pickMode).toBe("face");
    await click(m.close); expect(canvas.props!.objectManipulation).toBe(true); expect(canvas.props!.pickMode).toBe("object");
    await click(m.edge); await click(m.edge); expect(canvas.props!.objectManipulation).toBe(true);
    await click(m.face); await click(m.color); expect(canvas.props!.pickMode).toBe("object");
    await act(async () => container.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("[data-cube-canvas-panel]")).toBeNull(); expect(canvas.props!.objectManipulation).toBe(true);
  });
  it("rolls a cuboid through a visible contact-edge arc and saves only its exact endpoint", async () => {
    const capture = vi.fn(), label = spatialActionMessages("en").roll;
    await render(createElement(SolidGeometryWorkspace, { onSnapshot: capture }));
    await click(label); expect(canvas.props!.rollAction?.plans["x+"]).toBeDefined();
    await click(`${label} X+`); expect(capture.mock.lastCall![0]).toBeNull();
    await advance(320); expect(canvas.props!.entities[0].position.x).toBeGreaterThan(0); expect(canvas.props!.entities[0].position.x).toBeLessThan(2.5);
    expect(canvas.props!.entities[0].position.y).toBeGreaterThan(1.5);
    await advance(); expect(capture.mock.lastCall![0].entities[0].position).toEqual({ x: 2.5, y: 1.5, z: 0 });
    await click(m.close); expect(canvas.props!.rollAction).toBeUndefined(); expect(canvas.props!.objectManipulation).toBe(true);
  });
  it("directly moves another entity while clearing the previous entity's feature selection", async () => {
    const initial = createSolidGeometryInitial(), capture = vi.fn();
    initial.entities.push(createSolidEntity("cube", "other", { x: 4, y: 1, z: 0 }));
    initial.feature = { entityId: "solid-origin", kind: "face", id: "front" };
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture }));
    expect(canvas.props!.objectManipulation).toBe(true);
    await act(async () => canvas.props!.onMove({ kind: "display-move", ids: ["other"], axis: "y", distance: 1 }));
    expect(capture.mock.lastCall![0].selectedId).toBe("other"); expect(capture.mock.lastCall![0].feature).toBeNull();
    expect(canvas.props!.entities[1].position.y).toBe(2);
    await click(m.face); expect(canvas.props!.objectManipulation).toBe(false);
    await click(m.orbit); expect(canvas.props!.objectManipulation).toBe(true);
  });
  it("prepares multiple true solids with shared right-toolbar and non-modal panel primitives", async () => {
    const initial = createSolidGeometryInitial(), capture = vi.fn();
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture }));
    expect(capture.mock.lastCall![0]).toEqual(initial);
    expect(container.querySelector(`[aria-label="${m.add}"]`)?.closest("[data-solid-tools-toolbar]")).not.toBeNull();
    await click(m.add); expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await textClick(m.kinds.sphere); await advance();
    const next = capture.mock.lastCall![0]; expect(next.entities).toHaveLength(2); expect(next.entities[1].kind).toBe("sphere");
    expect(next.entities[1].id).toMatch(/^[0-9a-f-]{36}$/); expect(next.selectedId).toBe(next.entities[1].id);
    expect(initial.entities).toHaveLength(1);
    await click(m.vertex); expect(container.textContent).toContain(m.noVertices);
    await click(m.remove); await advance(); expect(capture.mock.lastCall![0].entities).toHaveLength(1);
  });
  it("commits legal dimensions, smoothly fades to fully transparent, and restores the prepared origin", async () => {
    const initial = { ...createSolidGeometryInitial(), entities: [createSolidEntity("cube", "solid-origin")] }, capture = vi.fn();
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture }));
    const camera = canvas.props!.frame;
    await click(m.objects);
    const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => { input.value = "3.5"; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(capture.mock.lastCall![0]).toBeNull(); await advance(120);
    expect(canvas.props!.entities[0].dimensions.width).toBeGreaterThan(2); expect(canvas.props!.entities[0].dimensions.width).toBeLessThan(3.5);
    await advance(); expect(capture.mock.lastCall![0].entities[0].dimensions).toMatchObject({ width: 3.5, height: 3.5, depth: 3.5 });
    expect(canvas.props!.frame).toEqual(camera);
    await click(m.transparent); await textClick("0%"); await advance(120);
    expect(canvas.props!.entities[0].opacity).toBeGreaterThan(0); expect(canvas.props!.entities[0].opacity).toBeLessThan(1);
    await advance(); expect(capture.mock.lastCall![0].entities[0].opacity).toBe(0);
    await click(m.reset); await advance(); expect(capture.mock.lastCall![0]).toEqual(initial); expect(canvas.props!.cameraRevision).toBe(1);
  });
  it("selects semantic features, rotates the solid and reuses direct drag endpoints without replay", async () => {
    const capture = vi.fn(); await render(createElement(SolidGeometryWorkspace, { onSnapshot: capture }));
    await click(m.face); await textClick(m.faces.front);
    expect(capture.mock.lastCall![0].feature).toEqual({ entityId: "solid-origin", kind: "face", id: "front" });
    await click(m.turn); await click(`${m.turn} Y 90°`); await advance(); expect(capture.mock.lastCall![0].entities[0].rotation.y).toBeCloseTo(Math.PI / 2);
    await click(m.move); expect(container.textContent).toContain(m.moveSnap);
    await act(async () => canvas.props!.onMove({ kind: "display-move", ids: ["solid-origin"], axis: "x", distance: 1.5 }));
    expect(canvas.props!.entities[0].position.x).toBe(1.5); expect(canvas.props!.state.entities[0].position.x).toBe(1.5);
    await advance(100); expect(canvas.props!.entities[0].position.x).toBe(1.5);
  });
  it("offers typed extension slots in the same stage and closes built-in panels for extension tools", async () => {
    const renderToolbar = vi.fn((context) => createElement("button", { "aria-label": "Extension", onClick: context.closePanel }, "Extension"));
    const renderPanel = vi.fn(() => null), renderScene = vi.fn(() => null), change = vi.fn();
    await render(createElement(SolidGeometryWorkspace, { renderToolbar, renderPanel, renderScene, onToolChange: change }));
    expect(container.querySelector('[aria-label="Extension"]')?.closest("[data-solid-tools-toolbar]")).not.toBeNull();
    const context = { entities: canvas.props!.entities, selected: canvas.props!.entities[0] };
    canvas.props!.renderScene!(context);
    expect(renderScene).toHaveBeenCalledWith(context);
    await click(m.objects); expect(change).toHaveBeenCalled(); await click("Extension"); expect(container.querySelector("[data-cube-canvas-panel]")).toBeNull();
    expect(renderToolbar.mock.lastCall![0]).toMatchObject({ disabled: false, locale: "en", selected: { kind: "cuboid" } });
  });
  it("combines measurement and sections in one saved scene and preserves direct drag when the shell is translucent", async () => {
    const initial = createSolidGeometryInitial(), capture = vi.fn();
    initial.entities = [createSolidEntity("cube", "solid-origin")];
    initial.measurement.unitFill = true; initial.measurement.fillLayers = 1;
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture }));
    await click(measurementMessages("en").title); await advance(120);
    expect(canvas.props!.entities[0].opacity).toBeGreaterThan(0.1); expect(canvas.props!.entities[0].opacity).toBeLessThan(1);
    await advance(); expect(canvas.props!.entities[0].opacity).toBe(0.1);
    expect(capture.mock.lastCall![0].entities[0].opacity).toBe(1);
    await click(m.move);
    await act(async () => canvas.props!.onMove({ kind: "display-move", ids: ["solid-origin"], axis: "x", distance: 1.5 }));
    expect(canvas.props!.entities[0].position.x).toBe(1.5);
    await click(solidSectionsMessages("en").title); await advance();
    expect(canvas.props!.state.section.enabled).toBe(true); expect(canvas.props!.state.measurement.enabled).toBe(false);
    expect(canvas.props!.entities[0].opacity).toBe(1);
    await click(m.reset); await advance();
    expect(capture.mock.lastCall![0]).toEqual(initial);
  });
});
describe("solid geometry common classroom writer", () => {
  it("holds a direct plane/ring endpoint through one classroom acknowledgement without replay", async () => {
    const initial = createSolidGeometryInitial(); let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; }), sent: SolidGeometrySnapshot[] = [];
    function Harness() { const [state, setState] = useState(solidGeometrySnapshot(initial)); return createElement(SolidGeometryWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness));
    const next = { ...initial.entities[0], position: { x: 2, y: 3.5, z: 0 }, rotation: { x: 0, y: 0, z: Math.PI / 2 } };
    await act(async () => { expect(canvas.props!.onTransform!(next)).toBe(true); });
    expect(sent).toHaveLength(1); expect(canvas.props!.entities[0]).toEqual(next); expect(canvas.props!.objectAnimating).toBe(false);
    await act(async () => { expect(canvas.props!.onTransform!(next)).toBe(false); });
    await act(async () => accept()); await advance(120);
    expect(sent).toHaveLength(1); expect(canvas.props!.entities[0]).toEqual(next); expect(canvas.props!.objectAnimating).toBe(false);
    expect(initial.entities[0].position).not.toEqual(next.position);
  });
  it("publishes one discrete change and waits for durable acceptance before animating", async () => {
    const initial = createSolidGeometryInitial(), origin = solidGeometrySnapshot(initial); let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; }); const sent: SolidGeometrySnapshot[] = [];
    function Harness() { const [state, setState] = useState(origin); return createElement(SolidGeometryWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness)); await click(m.transparent); await textClick("25%");
    expect(sent).toHaveLength(1); expect(canvas.props!.state.entities[0].opacity).toBe(1); expect(canvas.props!.readOnly).toBe(true);
    await textClick("0%"); expect(sent).toHaveLength(1);
    await act(async () => accept()); await advance(120); expect(canvas.props!.entities[0].opacity).toBeGreaterThan(0.25); expect(canvas.props!.entities[0].opacity).toBeLessThan(1);
    await advance(); expect(canvas.props!.entities[0].opacity).toBe(0.25); expect(sent).toHaveLength(1); expect(initial.entities[0].opacity).toBe(1);
  });
  it("retains the confirmed state on failure and restores a read-only late joiner without draft reads", async () => {
    const initial = createSolidGeometryInitial(), capture = vi.fn(), fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture, classroom: { state: solidGeometrySnapshot(initial), onChange: async () => { throw new Error("offline"); } } }));
    await click(m.color); await click(m.colors[1]); expect(container.querySelector('[role="alert"]')?.textContent).toBe(m.syncError); expect(canvas.props!.state.entities[0].color).toBe(initial.entities[0].color);
    const restored = solidGeometrySnapshot(initial); restored.entities[0].opacity = 0.5; restored.view = "bottom";
    await render(createElement(SolidGeometryWorkspace, { key: "viewer", initial, classroom: { state: restored } }));
    expect(canvas.props!.state.view).toBe("bottom"); expect(canvas.props!.entities[0].opacity).toBe(0.5); expect(canvas.props!.readOnly).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>('[data-solid-tools-toolbar] button')].every((button) => button.disabled)).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
});
