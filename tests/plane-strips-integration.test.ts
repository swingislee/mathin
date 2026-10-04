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
import { createStripsState, setStripCount, squareStripModel, toggleStrips } from "@/features/tools/plane-relations/strips-model";
import { stripsBaseState } from "@/features/tools/plane-relations/strips-validation";
import { relationFlag } from "@/features/tools/plane-relations/model";
import { angleTriangle } from "@/features/tools/plane-relations/angle-model";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const definition = planarScene("18-strips"), version = "plane-area-relations-lesson-v4";
const shown = () => toggleStrips(setStripCount(createStripsState(), 8));

describe("square-strip version and shared classroom contract", () => {
  it("registers only v4 for new insertion and keeps every older version readable", () => {
    expect(PLANAR_TOOLS.find((tool) => tool.id === "plane-area-relations")!.version).toBe(version);
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === "plane-area-relations").map((entry) => entry.contentVersion)).toEqual([version]);
    for (const legacy of ALL_PLANAR_TOOLS.filter((tool) => tool.id === "plane-area-relations" && tool.version !== version)) for (const scene of scenesForPlanarTool(legacy.id, legacy.version)) {
      const state = scene.create();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: legacy.version, payload: { title: "Historical", initial: state } })).not.toThrow();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: version, payload: { title: "Foreign", initial: state } })).toThrow();
      expect(planarSnapshotForTool(legacy.id, legacy.version).safeParse(planarSnapshot(shown())).success).toBe(false);
    }
  });

  it("freezes density, replays exact endpoints without randomUUID and isolates one undo per action", () => {
    const initial = shown(), prepared = parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Square strips", initial } });
    const frozen = freezeToolScene(prepared), saved = JSON.stringify(frozen);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      for (const id of ["relations-refine-strips", "relations-copy-strips", "construction-rotate", "relations-scale-half"]) {
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

describe("square strips in the shared workbench", () => {
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

  it("starts without results, edits density, refines and keeps observations after panel close or Escape", async () => {
    await render(); expect(current()!.sceneId).toBe("18-strips"); const initial = current()!, id = initial.params.active;
    expect(container.querySelector("[data-square-strip]")).toBeNull(); await select(id);
    await act(async () => button("正方形条带与细分").click()); await act(async () => button("显示正方形条带").click());
    expect(relationFlag(current()!, "strips")).toBe(true);
    const field = container.querySelector<HTMLInputElement>('input[aria-label="细分密度（底与高中较长者的等分数）"]')!;
    await act(async () => { field.value = "8"; field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(squareStripModel(current()!)!.divisions).toBe(8);
    await act(async () => button("继续细分方格条").click()); expect(squareStripModel(current()!)!.divisions).toBe(16);
    const beforeClose = current()!, rows = container.querySelectorAll("[data-square-strip]").length;
    await act(async () => button("关闭面板").click()); expect(current()).toEqual(beforeClose); expect(container.querySelectorAll("[data-square-strip]")).toHaveLength(rows);
    await act(async () => button("正方形条带与细分").click());
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(current()).toEqual(beforeClose);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial); expect(container.querySelector("[data-square-strip]")).toBeNull();
  });

  it("copies independent strips, selects the first new material and restores the exact source with undo", async () => {
    const initial = shown(); await render({ initial }); await select(initial.params.active);
    await act(async () => button("正方形条带与细分").click()); await act(async () => button("复制近似条为独立材料").click());
    const copied = current()!;
    expect(constructionObjects(copied)).toHaveLength(1 + squareStripModel(initial)!.strips.length);
    expect(shape(copied.params.active).getAttribute("aria-pressed")).toBe("true"); expect(squareStripModel(copied)).toBeNull();
    expect(button("显示正方形条带").disabled).toBe(true);
    const at = constructionObject(copied)!.center;
    await pointer(shape(copied.params.active), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 40, at.y + 15); await pointer(stage(), "pointerup", at.x + 40, at.y + 15);
    expect(constructionObject(current()!)!.center.x).toBeCloseTo(at.x + 40, 7);
    expect(constructionObject(current()!, initial.params.active)).toEqual(constructionObject(initial));
    await act(async () => button("撤销").click()); expect(current()).toEqual(copied);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("retains strip settings and fixed area through cancellable equal-height vertex dragging", async () => {
    const initial = definition.setField!(shown(), "heightLock", 1); await render({ initial }); await select(initial.params.active);
    await act(async () => button("编辑当前图形").click());
    const start = current()!, model = squareStripModel(start)!, at = model.c;
    const handle = () => container.querySelector(`[data-construction-edit-handle="vertex.${initial.params.active}.2"]`)!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 70, at.y - 30); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", at.x + 70, at.y - 30); expect(current()).toEqual(start);
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 70, at.y - 30); await pointer(stage(), "pointerup", at.x + 70, at.y - 30);
    const moved = squareStripModel(current()!)!;
    expect(moved.c.x).toBeCloseTo(at.x + 70, 7); expect(moved.c.y).toBeCloseTo(at.y, 7);
    expect(moved.approximateArea).toBeCloseTo(model.approximateArea, 7); expect(moved.area).toBeCloseTo(model.area, 7);
    await act(async () => button("撤销").click()); expect(current()).toEqual(start);
  });

  it("saves legal scaling pause frames with strips and reuses the existing one-action undo", async () => {
    const initial = shown(), before = squareStripModel(initial)!; await render({ initial }); await select(initial.params.active);
    await act(async () => button("定点等比伸缩").click()); await act(async () => button("两边缩为一半").click());
    expect(current()).toBeNull(); await tick(500); await act(async () => button("暂停过程").click());
    const paused = current()!, model = squareStripModel(paused)!;
    expect(model.size).toBeLessThan(before.size); expect(model.size).toBeGreaterThan(before.size / 2);
    expect(model.squareCount).toBe(before.squareCount); expect(model.approximateArea / before.approximateArea).toBeCloseTo((model.size / before.size) ** 2, 8);
    expect(angleTriangle(stripsBaseState(paused))!.area).toBeCloseTo(model.area, 8);
    expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Paused", initial: paused } })).not.toThrow();
    await act(async () => button("继续过程").click()); await tick(901); expect(squareStripModel(current()!)!.area).toBeCloseTo(before.area / 4, 7);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("publishes density once, preserves acknowledgement and keeps the display read-only", async () => {
    const initial = shown(), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(initial.params.active);
    await act(async () => button("正方形条带与细分").click()); await act(async () => button("继续细分方格条").click());
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]); expect(squareStripModel(endpoint.current)!.divisions).toBe(16);
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } }); await tick(2000);
    expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
    await render({ initial: endpoint.current, readOnly: true, locale: "en" });
    expect(button("Square strips and refinement").disabled).toBe(true); expect(container.querySelector("[data-square-strip]")).not.toBeNull();
    expect(container.querySelector("[data-construction-edit-handle]")).toBeNull();
  });
});
