// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { ALL_PLANAR_TOOLS, PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { planarCommit, planarFrame, planarHistory } from "@/features/tools/planar-kit/presentation";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { relationFlag } from "@/features/tools/plane-relations/model";
import { cellCoverageModel, createCoverageState, setCoverCount, toggleCoverCells } from "@/features/tools/plane-relations/coverage-model";
import { planeCoverageScene } from "@/features/tools/plane-relations/coverage-scene";
import { planeCellCoverageCases } from "./fixtures/plane-cell-coverage-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const definition = planeCoverageScene, version = "plane-area-relations-lesson-v5";
const shown = () => toggleCoverCells(setCoverCount(createCoverageState(), 8));

describe("cell coverage version and classroom contracts", () => {
  it("inserts v5, retains all historical scenes and keeps cross-version states isolated", () => {
    expect(planarScene("18-coverage")).toBe(definition);
    expect(PLANAR_TOOLS.find((tool) => tool.id === "plane-area-relations")!.version).toBe(version);
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === "plane-area-relations").map((entry) => entry.contentVersion)).toEqual([version]);
    for (const legacy of ALL_PLANAR_TOOLS.filter((tool) => tool.id === "plane-area-relations" && tool.version !== version)) for (const scene of scenesForPlanarTool(legacy.id, legacy.version)) {
      const state = scene.create();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: legacy.version, payload: { title: "Historical", initial: state } })).not.toThrow();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: version, payload: { title: "Foreign", initial: state } })).toThrow();
      expect(planarSnapshotForTool(legacy.id, legacy.version).safeParse(planarSnapshot(shown())).success).toBe(false);
    }
    for (const entry of planeCellCoverageCases()) {
      if (entry.accepted) expect(() => parseToolScene(entry.scene), entry.label).not.toThrow();
      else expect(() => parseToolScene(entry.scene), entry.label).toThrow();
    }
  });

  it("freezes exact settings, replays endpoints without randomUUID, and undoes each action once", () => {
    const initial = shown(), prepared = parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Cell coverage", initial } });
    const frozen = freezeToolScene(prepared), saved = JSON.stringify(frozen);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      for (const id of ["relations-refine-cover-cells", "construction-duplicate", "construction-rotate", "relations-scale-half", "relations-refine-strips"]) {
        const action = [...definition.actions ?? [], ...definition.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
        const endpoint = action.run(initial, { selected: `object.${initial.params.active}` }); expect(endpoint).not.toEqual(initial);
        const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, action.duration ? { id, duration: action.duration, now: 100 } : undefined);
        expect(planarSnapshotForTool("plane-area-relations", version).safeParse(snapshot).success).toBe(true);
        expect(snapshot.past).toEqual([initial]); expect(planarHistory(snapshot, "undo").current).toEqual(initial);
        const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-area-relations", contentVersion: version, state: snapshot }, toolSceneOriginHash(frozen.payload));
        expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
        expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 500)).toEqual(planarFrame(snapshot, definition, 500));
        expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Result", initial: endpoint } })).not.toThrow();
      }
    } finally { vi.unstubAllGlobals(); }
    expect(JSON.stringify(frozen)).toBe(saved);
  });
});

let container: HTMLDivElement, root: Root, time: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const shape = (id: number) => container.querySelector<SVGGElement>(`g[data-construction-object="${id}"] > g[role="button"]`)!;
async function pointer(target: Element, type: string, x: number, y: number) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 })));
}
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-area-relations", locale: "zh", onSnapshot: capture, ...props })));
};
async function select(id: number) {
  const at = constructionObject(current()!, id)!.center;
  await pointer(shape(id), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
}
async function tick(ms: number) {
  time += ms; const callbacks = [...frames.values()]; frames.clear(); await act(async () => callbacks.forEach((frame) => frame(time)));
}

describe("cell coverage in the shared workbench", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("starts without coverage, edits density, refines and keeps the observation after close or Escape", async () => {
    await render(); expect(current()!.sceneId).toBe("18-coverage"); const initial = current()!, id = initial.params.active;
    expect(container.querySelector("[data-cell-coverage-object]")).toBeNull(); await select(id);
    await act(async () => button("完整格与边界格覆盖").click()); await act(async () => button("显示完整格与边界格").click());
    expect(relationFlag(current()!, "coverCells")).toBe(true);
    expect(container.querySelector("[data-cell-coverage-measures]")).toBeNull();
    const field = container.querySelector<HTMLInputElement>('input[aria-label="覆盖密度（投影宽高中较长者的等分数）"]')!;
    await act(async () => { field.value = "8"; field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(cellCoverageModel(current()!)!.divisions).toBe(8);
    const coarse = current()!;
    await act(async () => button("继续细分覆盖方格").click()); expect(cellCoverageModel(current()!)!.divisions).toBe(16);
    await act(async () => button("撤销").click()); expect(current()).toEqual(coarse);
    await act(async () => button("重做").click()); expect(cellCoverageModel(current()!)!.divisions).toBe(16);
    await act(async () => button("显示长度与面积").click()); expect(container.querySelector("[data-cell-coverage-measures]")).not.toBeNull();
    const beforeClose = current()!;
    await act(async () => button("关闭面板").click()); expect(current()).toEqual(beforeClose);
    expect(container.querySelector("[data-cell-coverage-object]")).not.toBeNull(); expect(container.querySelector("[data-cell-coverage-measures]")).not.toBeNull();
    await act(async () => button("完整格与边界格覆盖").click());
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(current()).toEqual(beforeClose);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial); expect(container.querySelector("[data-cell-coverage-object]")).toBeNull();
  });

  it("copies independent material settings, follows selection and removes only the chosen metadata", async () => {
    const initial = shown(); await render({ initial }); await select(initial.params.active);
    const action = definition.actions!.find((entry) => entry.id === "construction-duplicate")!;
    await act(async () => button(action.label.zh).click());
    const copied = current()!, id = copied.params.active;
    expect(constructionObjects(copied)).toHaveLength(2); expect(shape(id).getAttribute("aria-pressed")).toBe("true");
    expect(copied.params[`coverCount.${id}`]).toBe(8); expect(relationFlag(copied, "coverCells", id)).toBe(true);
    const at = constructionObject(copied)!.center;
    await pointer(shape(id), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 37, at.y + 18); await pointer(stage(), "pointerup", at.x + 37, at.y + 18);
    expect(constructionObject(current()!, initial.params.active)).toEqual(constructionObject(initial));
    await act(async () => button(definition.actions!.find((entry) => entry.id === "construction-remove")!.label.zh).click());
    expect(current()!.params[`coverCount.${id}`]).toBeUndefined(); expect(current()!.flags[`coverCells.${id}`]).toBeUndefined();
    expect(relationFlag(current()!, "coverCells", initial.params.active)).toBe(true);
    await act(async () => button("撤销").click()); expect(current()!.params[`coverCount.${id}`]).toBe(8);
  });

  it("cancels live vertex previews and recomputes the coverage from committed constrained geometry", async () => {
    const initial = definition.setField!(shown(), "heightLock", 1); await render({ initial }); await select(initial.params.active);
    await act(async () => button("编辑当前图形").click());
    const start = current()!, model = cellCoverageModel(start)!, at = model.heights[0].vertex;
    const handle = () => container.querySelector(`[data-construction-edit-handle="vertex.${initial.params.active}.2"]`)!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 210, at.y - 30); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", at.x + 210, at.y - 30); expect(current()).toEqual(start);
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 210, at.y - 30); await pointer(stage(), "pointerup", at.x + 210, at.y - 30);
    const moved = cellCoverageModel(current()!)!;
    expect(moved.heights[0].vertex.x).toBeCloseTo(at.x + 210, 7); expect(moved.heights[0].vertex.y).toBeCloseTo(at.y, 7);
    expect(moved.area).toBeCloseTo(model.area, 7); expect(moved.innerArea).toBeLessThanOrEqual(moved.area); expect(moved.outerArea).toBeGreaterThanOrEqual(moved.area);
    expect(relationFlag(current()!, "coverCells")).toBe(true);
    await act(async () => button("撤销").click()); expect(current()).toEqual(start);
  });

  it("saves legal scaling pause frames with coverage and reuses the one-action undo", async () => {
    const initial = shown(), before = cellCoverageModel(initial)!; await render({ initial }); await select(initial.params.active);
    await act(async () => button("定点等比伸缩").click()); await act(async () => button("两边缩为一半").click());
    expect(current()).toBeNull(); await tick(500); await act(async () => button("暂停过程").click());
    const paused = current()!, model = cellCoverageModel(paused)!;
    expect(model.size).toBeLessThan(before.size); expect(model.size).toBeGreaterThan(before.size / 2);
    expect(model.area / before.area).toBeCloseTo((model.size / before.size) ** 2, 8);
    expect(model.innerArea).toBeLessThanOrEqual(model.area); expect(model.outerArea).toBeGreaterThanOrEqual(model.area);
    expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Paused", initial: paused } })).not.toThrow();
    await act(async () => button("继续过程").click()); await tick(901); expect(cellCoverageModel(current()!)!.area).toBeCloseTo(before.area / 4, 7);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("publishes density once, preserves the acknowledgement and keeps displays read-only", async () => {
    const initial = shown(), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(initial.params.active);
    await act(async () => button("完整格与边界格覆盖").click()); await act(async () => button("继续细分覆盖方格").click());
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]); expect(cellCoverageModel(endpoint.current)!.divisions).toBe(16);
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } }); await tick(2000);
    expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
    await render({ initial: endpoint.current, readOnly: true, locale: "en" });
    expect(button("Full and boundary cell coverage").disabled).toBe(true); expect(container.querySelector("[data-cell-coverage-object]")).not.toBeNull();
    expect(container.querySelector("[data-construction-edit-handle]")).toBeNull();
  });
});
