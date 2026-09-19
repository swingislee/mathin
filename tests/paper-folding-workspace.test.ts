// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaperFoldingWorkspace, type PaperFoldingWorkspaceProps } from "@/features/tools/paper-folding/PaperFoldingWorkspace";
import { createDefaultPaperFoldingSnapshot, type PaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { resolvePaperFolding } from "@/features/tools/paper-folding/model";
import { cubeNetPaperSelection, type CubeNetFoldChange, type CubeNetPaperSelection } from "@/features/tools/spatial-lab/cube-net-fold-drag";

type ViewportProps = { snapshot: PaperFoldingSnapshot; interactive: boolean; onFoldStart: (selection: CubeNetPaperSelection) => void; onPreview: (value: CubeNetFoldChange | null) => void; onCommit: (value: CubeNetFoldChange) => void; onDraggingChange: (value: boolean) => void };
const viewport = vi.hoisted(() => ({ current: null as ViewportProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function ViewportStub(props: ViewportProps) { viewport.current = props; return null; } }));
let root: Root, host: HTMLDivElement, frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); frames.clear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (props: Partial<PaperFoldingWorkspaceProps> = {}) => act(async () => root.render(createElement(PaperFoldingWorkspace, { locale: "en", ...props })));
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(found).toBeDefined(); return found!;
}
const click = async (label: string) => act(async () => button(label).click());
async function tick(now: number) { const tasks = [...frames.values()]; frames.clear(); await act(async () => tasks.forEach((callback) => callback(now))); }
function foldChange(initial: PaperFoldingSnapshot, degrees: number) {
  const model = resolvePaperFolding(initial), face = model.model.faces.at(-1)!;
  const selected = cubeNetPaperSelection(face, model.model.faces, model.hinges, face.centroid)!;
  return { selection: selected.selection, value: { edgeId: selected.hinge.edgeId, degrees, anchor: selected.selection.anchor } };
}

describe("free paper preparation workspace", () => {
  it("edits connected squares, warns about loops, and restores/undoes without replacing the canvas", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    const canvas = host.querySelector('[data-cube-workspace-frame="4:3"]');
    await click("Arrange squares");
    await click("Add square at (2, 1)");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("loop");
    expect(viewport.current!.snapshot.squares).toHaveLength(6);
    await click("Add square at (4, 0)");
    expect(viewport.current!.snapshot.squares).toHaveLength(7);
    expect(capture.mock.calls.at(-1)![0].squares).toHaveLength(7);
    await click("Undo"); expect(viewport.current!.snapshot.squares).toHaveLength(6);
    await click("Redo"); expect(viewport.current!.snapshot.squares).toHaveLength(7);
    await click("Restore prepared start"); expect(viewport.current!.snapshot).toEqual(createDefaultPaperFoldingSnapshot());
    expect(host.querySelector('[data-cube-workspace-frame="4:3"]')).toBe(canvas);
  });
  it("keeps drag handlers stable through previews and only captures a completed gesture", async () => {
    const capture = vi.fn(), initial = createDefaultPaperFoldingSnapshot(); await render({ initial, onSnapshot: capture });
    const before = viewport.current!, { selection, value } = foldChange(initial, 37);
    await act(async () => { before.onFoldStart(selection); before.onDraggingChange(true); before.onPreview(value); });
    expect(viewport.current!.onPreview).toBe(before.onPreview);
    expect(viewport.current!.onCommit).toBe(before.onCommit);
    expect(capture.mock.calls.at(-1)![0]).toBeNull();
    expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(37);
    await act(async () => { viewport.current!.onCommit(value); viewport.current!.onDraggingChange(false); });
    expect(capture.mock.calls.at(-1)![0].angles[value.edgeId]).toBe(37);
    expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(37);
  });
  it("reconstructs continuous folding on a read-only classroom display", async () => {
    const initial = createDefaultPaperFoldingSnapshot(), { value } = foldChange(initial, 90);
    const next: PaperFoldingSnapshot = { ...initial, angles: { ...initial.angles, [value.edgeId]: 90 }, anchor: { ...value.anchor, vertices: [...value.anchor.vertices] } };
    await render({ initial, readOnly: true, runtime: { state: initial } });
    await render({ initial, readOnly: true, runtime: { state: next } });
    expect(viewport.current!.interactive).toBe(false);
    expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(0);
    await tick(100); await tick(260);
    expect(viewport.current!.snapshot.angles[value.edgeId]).toBeCloseTo(45);
    await tick(420);
    expect(viewport.current!.snapshot).toEqual(next);
    expect(button("Arrange squares").disabled).toBe(true);
  });
  it("keeps a teacher preview until acknowledgment and does not replay the same drag afterward", async () => {
    const initial = createDefaultPaperFoldingSnapshot(), onChange = vi.fn<(next: PaperFoldingSnapshot) => Promise<void>>().mockResolvedValue(undefined), { selection, value } = foldChange(initial, 42);
    await render({ initial, runtime: { state: initial, onChange } });
    await act(async () => { viewport.current!.onFoldStart(selection); viewport.current!.onPreview(value); viewport.current!.onCommit(value); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(viewport.current!.snapshot.angles[value.edgeId]).toBe(42);
    const next = onChange.mock.calls[0][0];
    await render({ initial, runtime: { state: next, onChange } });
    expect(viewport.current!.snapshot).toEqual(next);
    expect(frames.size).toBe(0);
  });
  it("preserves the authoritative scene after a failed classroom write", async () => {
    const initial = createDefaultPaperFoldingSnapshot(), onChange = vi.fn(async () => { throw new Error("write failed"); }), { value } = foldChange(initial, 42);
    await render({ initial, runtime: { state: initial, onChange } });
    await act(async () => { viewport.current!.onPreview(value); viewport.current!.onCommit(value); });
    expect(viewport.current!.snapshot).toEqual(initial);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("not saved");
    expect(button("Undo").disabled).toBe(true);
  });
});
