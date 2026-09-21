// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DisplacementWorkspace } from "@/features/tools/solid-capacity/DisplacementWorkspace";
import type { DisplacementSceneProps } from "@/features/tools/solid-capacity/DisplacementScene";
import type { SolidGeometryCanvasProps } from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { createDefaultDisplacementInitial, displacementSnapshot, type DisplacementSnapshot } from "@/features/tools/solid-capacity/displacement-contract";
import { placeDisplacementBody, solveDisplacement } from "@/features/tools/solid-capacity/displacement-math";
import { displacementMessages } from "@/features/tools/solid-capacity/displacement-messages";

const canvas = vi.hoisted(() => ({ props: null as SolidGeometryCanvasProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/features/tools/solid-capacity/DisplacementScene", () => ({ DisplacementScene: () => null }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SolidGeometryCanvasProps) { canvas.props = props; return null; } }));
let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
const m = displacementMessages("en");
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
async function advance(ms = 700) { now += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const frame of pending) frame(now); }); }
async function finish() { await advance(1); await advance(700); }
function sceneProps() { return (canvas.props!.renderScene!({ entities: [], selected: null }) as ReactElement<DisplacementSceneProps>).props; }

describe("displacement teacher workbench", () => {
  it("shows the immersion handle only in its operation, without changing saved teaching state", async () => {
    const initial = createDefaultDisplacementInitial(), capture = vi.fn();
    await render(createElement(DisplacementWorkspace, { initial, onSnapshot: capture }));
    expect(sceneProps().showMoveHandle).toBe(false);
    await act(async () => sceneProps().onSelect()); expect(sceneProps().showMoveHandle).toBe(false);
    await click(m.move); expect(sceneProps().showMoveHandle).toBe(true);
    await click(m.move); expect(sceneProps().showMoveHandle).toBe(false);
    await click(m.move); await click(m.dimensions); expect(sceneProps().showMoveHandle).toBe(false);
    await click(m.move); await click(m.close); expect(sceneProps().showMoveHandle).toBe(false);
    await click(m.move); await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(sceneProps().showMoveHandle).toBe(false); expect(sceneProps().selectionActive).toBe(false);
    expect(capture.mock.lastCall![0]).toEqual(initial);
  });
  it("animates immersion through actual middle states and restores the prepared origin", async () => {
    const initial = createDefaultDisplacementInitial(), capture = vi.fn();
    await render(createElement(DisplacementWorkspace, { initial, onSnapshot: capture })); expect(capture.mock.lastCall![0]).toEqual(initial);
    await click(m.move); expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await textClick(m.immerse); expect(capture.mock.lastCall![0]).toBeNull(); await advance(1); await advance(450);
    expect(sceneProps().frame.body.bottom).toBeLessThan(initial.body.bottom); expect(sceneProps().frame.body.bottom).toBeGreaterThan(sceneProps().snapshot.body.bottom);
    expect(solveDisplacement(sceneProps().frame).waterVolume).toBe(48); await advance();
    expect(solveDisplacement(sceneProps().frame).fullySubmerged).toBe(true);
    await click(m.reset); await finish(); expect(capture.mock.lastCall![0]).toEqual(initial); expect(canvas.props!.cameraRevision).toBe(1);
  });
  it("uses an optional volume readout, another shape and the shared deselection logic", async () => {
    const capture = vi.fn(); await render(createElement(DisplacementWorkspace, { onSnapshot: capture }));
    expect(container.textContent).not.toContain(m.displaced); await click(m.amounts); expect(container.textContent).toContain(m.displaced);
    await click(m.dimensions); await textClick(m.stepped); await finish(); expect(capture.mock.lastCall![0].body.kind).toBe("stepped");
    await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(sceneProps().selectionActive).toBe(false); await act(async () => sceneProps().onSelect()); expect(sceneProps().selectionActive).toBe(true);
  });
  it("stops at the rim and gives a reason while keeping all water", async () => {
    const base = createDefaultDisplacementInitial(), initial = { ...base, tank: { ...base.tank, waterHeight: 4.9 } };
    await render(createElement(DisplacementWorkspace, { initial })); await click(m.move); await textClick(m.immerse); await finish();
    const result = solveDisplacement(sceneProps().frame);
    expect(result.waterHeight).toBeCloseTo(5); expect(result.overflow).toBe(false); expect(result.fullySubmerged).toBe(false);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(m.rim);
  });
});

describe("displacement classroom endpoints", () => {
  it("holds a direct drag result until acknowledgement without replaying the movement", async () => {
    const initial = createDefaultDisplacementInitial(); let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; }), sent: DisplacementSnapshot[] = [];
    function Harness() { const [state, setState] = useState(displacementSnapshot(initial)); return createElement(DisplacementWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness));
    const next = placeDisplacementBody(sceneProps().snapshot, 1.123).state;
    await act(async () => { sceneProps().onPreview(next); sceneProps().onDragging(true); });
    expect(sceneProps().frame.body.bottom).toBe(1.123);
    await act(async () => { const props = sceneProps(); props.onPreview(null); props.onDragging(false); props.onCommit(next); });
    expect(sent).toHaveLength(1); expect(sceneProps().frame.body.bottom).toBe(1.123);
    await act(async () => accept()); await advance(1); expect(sceneProps().frame.body.bottom).toBe(1.123); expect(frames.size).toBe(0);
    expect(sent[0]).not.toHaveProperty("frame");
  });
  it("animates once for button changes after acceptance and restores late viewers immediately", async () => {
    const initial = createDefaultDisplacementInitial(), sent: DisplacementSnapshot[] = [];
    function Harness() { const [state, setState] = useState(displacementSnapshot(initial)); return createElement(DisplacementWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); setState(next); } } }); }
    await render(createElement(Harness)); await click(m.move); await textClick(m.halfway); await advance(1); await advance(320);
    expect(sceneProps().frame.body.bottom).toBeGreaterThan(sceneProps().snapshot.body.bottom); await advance(); expect(sent).toHaveLength(1);
    const confirmed = sent[0]; expect(solveDisplacement(confirmed).displacedVolume).toBeCloseTo(4);
    await render(createElement(DisplacementWorkspace, { key: "viewer", initial, classroom: { state: confirmed } }));
    expect(sceneProps().frame.body.bottom).toBe(confirmed.body.bottom); expect(canvas.props!.readOnly).toBe(true); expect(frames.size).toBe(0);
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-displacement-tools-toolbar] button")].every((button) => button.disabled)).toBe(true);
  });
  it("restores a failed direct classroom write to the confirmed scene", async () => {
    const initial = createDefaultDisplacementInitial();
    await render(createElement(DisplacementWorkspace, { initial, classroom: { state: displacementSnapshot(initial), onChange: async () => { throw new Error("offline"); } } }));
    const next = placeDisplacementBody(sceneProps().snapshot, 0.7).state;
    await act(async () => sceneProps().onCommit(next)); await finish();
    expect(sceneProps().frame.body.bottom).toBeCloseTo(initial.body.bottom);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(m.syncError);
  });
  it("keeps a retried drag at its shown endpoint while the failed flag is cleared", async () => {
    const initial = createDefaultDisplacementInitial(); let attempt = 0, accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Harness() { const [state, setState] = useState(displacementSnapshot(initial)); return createElement(DisplacementWorkspace, { initial, classroom: { state, onChange: async (next) => {
      attempt++; if (attempt === 1) throw new Error("offline"); await pending; setState(next);
    } } }); }
    await render(createElement(Harness));
    await act(async () => sceneProps().onCommit(placeDisplacementBody(sceneProps().snapshot, 1).state)); await finish();
    await act(async () => sceneProps().onCommit(placeDisplacementBody(sceneProps().snapshot, 0.8).state));
    await advance(1); await advance(); expect(sceneProps().frame.body.bottom).toBe(0.8);
    await act(async () => accept()); expect(sceneProps().frame.body.bottom).toBe(0.8); expect(frames.size).toBe(0);
  });
});
