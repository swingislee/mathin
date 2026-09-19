// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidNetsWorkspace, type SolidNetsWorkspaceProps } from "@/features/tools/solid-nets/SolidNetsWorkspace";
import type { SolidNetsViewportProps } from "@/features/tools/solid-nets/SolidNetsViewport";
import { createDefaultSolidNetsSnapshot, type SolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { resolveSolidNet, solidNetAllMotion } from "@/features/tools/solid-nets/model";
import { cubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";

const viewport = vi.hoisted(() => ({ current: null as SolidNetsViewportProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function ViewportStub(props: SolidNetsViewportProps) { viewport.current = props; return null; } }));
let root: Root, host: HTMLDivElement, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
  it("uses a stable 4:3 canvas and switches solids inside a floating panel", async () => {
    await render({ workspaceSelector: createElement("span", { "data-modes": true }, "modes") });
    const canvas = host.querySelector('[data-cube-workspace-frame="4:3"]');
    expect(canvas?.contains(host.querySelector("[data-modes]"))).toBe(true);
    await click("Solid & dimensions");
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
  it("retains the teacher preview until durable acknowledgment and never replays that gesture", async () => {
    const initial = createDefaultSolidNetsSnapshot("triangular-prism"), onChange = vi.fn<(next: SolidNetsSnapshot) => Promise<void>>().mockResolvedValue(undefined);
    await render({ initial, runtime: { state: initial, onChange } });
    const { selection, value } = foldChange(initial, 110);
    await act(async () => { viewport.current!.onFoldStart(selection); viewport.current!.onPreview(value); viewport.current!.onCommit(value); });
    expect(onChange).toHaveBeenCalledTimes(1); expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(110);
    const next = onChange.mock.calls[0][0]; await render({ initial, runtime: { state: next, onChange } });
    expect(viewport.current!.snapshot).toEqual(next); expect(frames.size).toBe(0);
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
