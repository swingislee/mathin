// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidNetsWorkspace, type SolidNetsWorkspaceProps } from "@/features/tools/solid-nets/SolidNetsWorkspace";
import type { SolidNetsViewportProps } from "@/features/tools/solid-nets/SolidNetsViewport";
import { createDefaultSolidNetsSnapshot, createDefaultSolidNetsTeachingSnapshot, createDefaultSolidNetsPolyhedraSnapshot, type AnySolidNetsSnapshot as SolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { resolveSolidNet, solidNetAllMotion } from "@/features/tools/solid-nets/model";
import { cubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";

const viewport = vi.hoisted(() => ({ current: null as SolidNetsViewportProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function ViewportStub(props: SolidNetsViewportProps) { viewport.current = props; return null; } }));
let root: Root, host: HTMLDivElement, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); frames.clear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (props: Partial<SolidNetsWorkspaceProps> = {}) => act(async () => root.render(createElement(SolidNetsWorkspace, { locale: "en", ...props })));
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found).toBeDefined(); return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function tick(now: number) { const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(now))); }
function foldChange(initial: SolidNetsSnapshot, degrees: number) {
  const model = resolveSolidNet(initial), face = model.model.faces[1];
  const selected = cubeNetPaperSelection(face, model.model.faces, model.hinges, face.centroid)!;
  return { selection: selected.selection, value: { edgeId: selected.hinge.edgeId, degrees, anchor: selected.selection.anchor } };
}

describe("solid nets prepared teaching space", () => {
  it("offers cube, cuboid and prism in the new tool, with one linked cube dimension", async () => {
    const capture = vi.fn(); await render({ initial: createDefaultSolidNetsTeachingSnapshot(), onSnapshot: capture });
    await click("Solid & dimensions");
    expect(button("Cube").getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toContain("Right square pyramid");
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(inputs).toHaveLength(1);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[0], "3");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(capture.mock.lastCall![0].dimensions).toEqual({ width: 3, height: 3, depth: 3 });
    await click("Cuboid");
    expect(host.querySelectorAll('input[type="number"]')).toHaveLength(3);
    expect(capture.mock.lastCall![0]).toMatchObject({ version: "solid-nets-v2", kind: "cuboid" });
    await click("Triangular prism (isosceles base)");
    expect(capture.mock.lastCall![0].kind).toBe("triangular-prism");
    await click("Restore prepared start");
    expect(capture.mock.lastCall![0]).toEqual(createDefaultSolidNetsTeachingSnapshot());
  });
  it("adds a square pyramid only in the new version, with linked base edges and an independent height", async () => {
    const capture = vi.fn(); await render({ initial: createDefaultSolidNetsPolyhedraSnapshot(), onSnapshot: capture });
    await click("Solid & dimensions"); await click("Right square pyramid");
    expect(viewport.current!.snapshot).toMatchObject({ version: "solid-nets-v3", kind: "square-pyramid" });
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(inputs).toHaveLength(2);
    expect(host.textContent).toContain("Base edge length"); expect(host.textContent).toContain("Pyramid height");
    for (const [index, value] of [[0, "4"], [1, "3"]] as const) await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(inputs[index], value);
      inputs[index].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(capture.mock.lastCall![0].dimensions).toEqual({ width: 4, height: 3, depth: 4 });
    const flat = viewport.current!.snapshot, folded = solidNetAllMotion(flat, true).target;
    await click("Fold into a solid in sequence"); await tick(100); await tick(320);
    expect(capture.mock.lastCall![0]).toBeNull();
    expect(viewport.current!.snapshot.angles["base-left"]).toBeCloseTo(folded.angles["base-left"] / 2);
    expect(viewport.current!.snapshot.angles["base-right"]).toBe(0);
    await tick(2000); expect(capture.mock.lastCall![0]).toEqual(folded);
    expect(inputs.every((input) => input.disabled)).toBe(true);
    await click("Unfold all in sequence"); await tick(2100); await tick(2320);
    expect(viewport.current!.snapshot.angles["base-left"]).toBeCloseTo(folded.angles["base-left"] / 2);
    expect(viewport.current!.snapshot.angles["base-right"]).toBe(folded.angles["base-right"]);
    await tick(4000); expect(capture.mock.lastCall![0]).toEqual(flat);
    expect(inputs.every((input) => !input.disabled)).toBe(true);
  });
  it("folds one pyramid side from the shared face panel and supports animated undo, redo and reset", async () => {
    const initial = createDefaultSolidNetsPolyhedraSnapshot("square-pyramid"); await render({ initial });
    await click("Face colors & labels"); await click("B");
    await click("Fold this face"); await tick(100); await tick(260);
    const closedAngle = solidNetAllMotion(initial, true).target.angles["base-left"];
    expect(viewport.current!.snapshot.angles["base-left"]).toBeCloseTo(closedAngle / 2);
    await tick(500);
    expect(viewport.current!.snapshot.angles).toEqual({ ...initial.angles, "base-left": closedAngle });
    await click("Undo"); await tick(600); await tick(1200);
    expect(viewport.current!.snapshot).toEqual(initial);
    await click("Redo"); await tick(1300); await tick(1700);
    expect(viewport.current!.snapshot.angles["base-left"]).toBe(closedAngle);
    await click("Restore prepared start"); await tick(1800); await tick(2400);
    expect(viewport.current!.snapshot).toEqual(initial);
  });
  it("clears face and hinge selection without unfolding or publishing a new scene", async () => {
    const initial = createDefaultSolidNetsSnapshot(), capture = vi.fn(); await render({ initial, onSnapshot: capture });
    const saved = viewport.current!.snapshot;
    await act(async () => viewport.current!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(viewport.current!.selected).toBeNull(); expect(viewport.current!.active).toBeNull();
    expect(viewport.current!.snapshot).toBe(saved); expect(capture.mock.lastCall![0]).toEqual(initial);
  });
  it("uses a stable 4:3 canvas and switches solids inside a floating panel", async () => {
    await render({ workspaceSelector: createElement("span", { "data-modes": true }, "modes") });
    const canvas = host.querySelector('[data-cube-workspace-frame="4:3"]');
    expect(canvas?.contains(host.querySelector("[data-modes]"))).toBe(true);
    await click("Solid & dimensions");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Cube")).toBe(false);
    expect(host.querySelector("[data-cube-canvas-panel]")).not.toBeNull();
    await click("Triangular prism (isosceles base)");
    expect(viewport.current!.snapshot.kind).toBe("triangular-prism");
    expect(host.querySelector('[data-cube-workspace-frame="4:3"]')).toBe(canvas);
    await click("Restore prepared start");
    expect(viewport.current!.snapshot.kind).toBe("cuboid");
  });
  it("animates consecutive faces before exporting a completed fold, and sequentially unfolds", async () => {
    const onSnapshot = vi.fn(); await render({ onSnapshot });
    await click("Fold into a solid in sequence");
    expect(onSnapshot.mock.calls.at(-1)![0]).toBeNull();
    await tick(100); await tick(320);
    expect(viewport.current!.snapshot.angles["base-left"]).toBeCloseTo(45);
    expect(viewport.current!.snapshot.angles["base-right"]).toBe(0);
    await tick(2400);
    const folded = onSnapshot.mock.calls.at(-1)![0] as SolidNetsSnapshot;
    expect(Object.values(folded.angles).every((angle) => angle === 90)).toBe(true);
    await click("Unfold all in sequence"); await tick(3000); await tick(3220);
    expect(viewport.current!.snapshot.angles["front-top"]).toBeCloseTo(45);
    expect(viewport.current!.snapshot.angles["base-left"]).toBe(90);
    await tick(5300);
    expect(viewport.current!.snapshot).toEqual(createDefaultSolidNetsSnapshot());
  });
  it("uses the accepted direct paper interaction without unstable callbacks or secure-context UUIDs", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try {
      const initial = createDefaultSolidNetsSnapshot("triangular-prism"), onSnapshot = vi.fn(); await render({ initial, onSnapshot });
      const before = viewport.current!, { selection, value } = foldChange(initial, 112);
      await act(async () => { before.onFoldStart(selection); before.onDraggingChange(true); before.onPreview(value); });
      expect(viewport.current!.onCommit).toBe(before.onCommit); expect(viewport.current!.onPreview).toBe(before.onPreview);
      expect(onSnapshot.mock.calls.at(-1)![0]).toBeNull(); expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(112);
      await act(async () => { viewport.current!.onCommit(value); viewport.current!.onDraggingChange(false); });
      expect(onSnapshot.mock.calls.at(-1)![0].angles[value.edgeId]).toBe(112);
    } finally { if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original); }
  });
  it.each([createDefaultSolidNetsSnapshot("triangular-prism"), createDefaultSolidNetsPolyhedraSnapshot("square-pyramid")])("$kind retains the teacher preview until durable acknowledgment and never replays that gesture", async (initial) => {
    const onChange = vi.fn<(next: SolidNetsSnapshot) => Promise<void>>().mockResolvedValue(undefined);
    await render({ initial, runtime: { state: initial, onChange } });
    const { selection, value } = foldChange(initial, 110);
    await act(async () => { viewport.current!.onFoldStart(selection); viewport.current!.onPreview(value); viewport.current!.onCommit(value); });
    expect(onChange).toHaveBeenCalledTimes(1); expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(110);
    const next = onChange.mock.calls[0][0]; await render({ initial, runtime: { state: next, onChange } });
    expect(viewport.current!.snapshot).toEqual(next); expect(frames.size).toBe(0);
  });
  it("replays pyramid folding on a read-only classroom display and late-joins at its exact saved state", async () => {
    const initial = createDefaultSolidNetsPolyhedraSnapshot("square-pyramid"), target = solidNetAllMotion(initial, true).target;
    await render({ initial, readOnly: true, runtime: { state: initial } });
    await render({ initial, readOnly: true, runtime: { state: target } });
    expect(viewport.current!.interactive).toBe(false);
    await tick(100); await tick(320);
    expect(viewport.current!.snapshot.angles["base-left"]).toBeCloseTo(target.angles["base-left"] / 2);
    await tick(2000); expect(viewport.current!.snapshot).toEqual(target);
    await act(async () => root.unmount()); root = createRoot(host);
    await render({ initial, readOnly: true, runtime: { state: target } });
    expect(viewport.current!.snapshot).toEqual(target); expect(frames.size).toBe(0);
  });
  it("reconstructs unfolding on a read-only display and late-joins at the latest snapshot", async () => {
    const initial = solidNetAllMotion(createDefaultSolidNetsSnapshot(), true).target;
    const next = solidNetAllMotion(initial, false).target;
    await render({ initial, readOnly: true, runtime: { state: initial } });
    expect(viewport.current!.snapshot).toEqual(initial); expect(frames.size).toBe(0);
    await render({ initial, readOnly: true, runtime: { state: next } });
    expect(viewport.current!.interactive).toBe(false); expect(button("Solid & dimensions").disabled).toBe(true);
    await tick(100); await tick(320);
    expect(viewport.current!.snapshot.angles["front-top"]).toBeCloseTo(45); expect(viewport.current!.snapshot.angles["base-left"]).toBe(90);
    await tick(2400); expect(viewport.current!.snapshot).toEqual(next);
  });
  it("keeps the confirmed scene after a failed write and exports no transient state", async () => {
    const initial = createDefaultSolidNetsSnapshot(), onChange = vi.fn(async () => { throw new Error("write failed"); }), onSnapshot = vi.fn();
    await render({ initial, onSnapshot, runtime: { state: initial, onChange } });
    const { value } = foldChange(initial, 40);
    await act(async () => { viewport.current!.onPreview(value); viewport.current!.onCommit(value); });
    expect(viewport.current!.snapshot).toEqual(initial); expect(onSnapshot.mock.calls.at(-1)![0]).toEqual(initial);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("not saved"); expect(button("Undo").disabled).toBe(true);
  });
  it("cancels a partial animation without saving or leaving an undo intent behind", async () => {
    const initial = createDefaultSolidNetsSnapshot(), onSnapshot = vi.fn(); await render({ initial, onSnapshot });
    await click("Fold into a solid in sequence"); await tick(100); await tick(320);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(viewport.current!.snapshot).toEqual(initial); expect(onSnapshot.mock.calls.at(-1)![0]).toEqual(initial);
    expect(frames.size).toBe(0); expect(button("Undo").disabled).toBe(true);
    await click("Show face labels"); expect(button("Undo").disabled).toBe(false);
    await click("Undo"); expect(viewport.current!.snapshot.labelsVisible).toBe(true);
    expect(button("Redo").disabled).toBe(false);
  });
});
