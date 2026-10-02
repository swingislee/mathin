// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { planarSnapshot, planarSnapshotForTool, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame } from "@/features/tools/planar-kit/presentation";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { constructionMeasurements, constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { createPerimeterState, perimeterInvariantHandle, perimeterRectangle } from "@/features/tools/plane-perimeter/model";
import { createRelationsState, relationModel, setRelationFlag } from "@/features/tools/plane-relations/model";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const tools = [["plane-perimeter", "10-create", ["perimeter-square-perimeter", "perimeter-square-area"]], ["plane-area-relations", "18-create", ["relations-copy-parts", "relations-nest-midpoints"]]] as const;

describe("invariant operations retain the existing geometry and classroom contracts", () => {
  for (const [toolId, sceneId, commands] of tools) it(`${toolId} preserves v2 preparation, frozen copies, both editors and replay`, () => {
    const definition = planarScene(sceneId), version = `${toolId}-lesson-v2` as const;
    const initial = toolId === "plane-area-relations" ? setRelationFlag(definition.create(), "division", true) : definition.create();
    const prepared = parseToolScene({ toolId, contentVersion: version, payload: { title: "Quantity exploration", initial } });
    const frozen = freezeToolScene(prepared), saved = JSON.stringify(frozen);
    const sourceCrypto = crypto; vi.stubGlobal("crypto", { getRandomValues: sourceCrypto.getRandomValues.bind(sourceCrypto) });
    try {
      for (const command of commands) {
        const action = definition.operations!.flatMap((entry) => entry.actions ?? []).find((entry) => entry.id === command)!;
        const endpoint = action.run(initial, { selected: `object.${initial.params.active}` });
        const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, action.duration ? { id: action.id, duration: action.duration, now: 100 } : undefined);
        expect(planarSnapshotForTool(toolId, version).safeParse(snapshot).success).toBe(true);
        const event = createClassroomToolState("page", "doc", "instance", { toolId, contentVersion: version, state: snapshot } as ClassroomToolUpdate, toolSceneOriginHash(frozen.payload));
        expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
        const reread = parseToolScene({ toolId, contentVersion: version, payload: { title: "Result", initial: endpoint } });
        expect("initial" in reread.payload && reread.payload.initial).toEqual(endpoint);
        if (snapshot.motion) {
          expect(snapshot.motion.id).toMatch(/^[a-f0-9-]{36}$/);
          expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 900)).toEqual(planarFrame(snapshot, definition, 900));
        }
      }
    } finally { vi.unstubAllGlobals(); }
    expect(JSON.stringify(frozen)).toBe(saved);
    for (const surface of ["microcourse", "formal-courseware"] as const) {
      expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === toolId).map((entry) => entry.contentVersion)).toEqual([version]);
    }
    for (const legacy of scenesForPlanarTool(toolId, `${toolId}-lesson-v1`)) {
      expect(() => parseToolScene({ toolId, contentVersion: `${toolId}-lesson-v1`, payload: { title: "Historical scene", initial: legacy.create() } })).not.toThrow();
    }
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
async function tick(ms: number) {
  time += ms; const callbacks = [...frames.values()]; frames.clear(); await act(async () => callbacks.forEach((frame) => frame(time)));
}
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-perimeter", locale: "zh", onSnapshot: capture, ...props })));
};
async function select(id: number) {
  const at = constructionObject(current()!, id)!.center;
  await pointer(shape(id), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
}

describe("new material actions in the shared planar workbench", () => {
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

  it("shares accurate inputs and direct deformation, cancels without saving and exits on close or Escape", async () => {
    await render(); await select(0); const initial = current()!;
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    await act(async () => button("定周长变形（矩形）").click());
    expect(container.querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(2);
    const width = container.querySelector<HTMLInputElement>('input[aria-label="矩形宽（u）"]')!;
    await act(async () => { width.value = "8"; width.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(perimeterRectangle(current()!)!.width).toBe(240); expect(perimeterRectangle(current()!)!.height).toBe(60);
    const beforeDrag = current()!, at = perimeterInvariantHandle(beforeDrag, "width")!.at;
    await pointer(container.querySelector('[data-perimeter-invariant-handle="width"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x - 30, at.y); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", at.x - 30, at.y); expect(current()).toEqual(beforeDrag);
    await pointer(container.querySelector('[data-perimeter-invariant-handle="width"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x - 30, at.y); await pointer(stage(), "pointerup", at.x - 30, at.y);
    expect(perimeterRectangle(current()!)!.width).toBe(180); expect(perimeterRectangle(current()!)!.height).toBe(120);
    await act(async () => button("撤销").click()); expect(current()).toEqual(beforeDrag);
    await act(async () => button("关闭面板").click()); expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    await act(async () => button("定面积变形（矩形）").click());
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull(); expect(current()).toEqual(beforeDrag);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });

  it("pauses a same-area square animation at an exact frame and keeps a read-only display inert", async () => {
    await render(); await select(0); const initial = current()!, area = constructionMeasurements(constructionObject(initial)!).area;
    await act(async () => button("定面积变形（矩形）").click());
    await act(async () => button("同面积变为正方形").click()); expect(current()).toBeNull();
    await tick(800); await act(async () => button("暂停过程").click());
    expect(constructionMeasurements(constructionObject(current()!)!).area).toBeCloseTo(area, 7);
    expect(perimeterRectangle(current()!)!.width).not.toBeCloseTo(perimeterRectangle(current()!)!.height, 4);
    await act(async () => button("继续过程").click()); await tick(801);
    expect(perimeterRectangle(current()!)!.width).toBeCloseTo(perimeterRectangle(current()!)!.height, 8);
    const completed = current()!;
    await render({ initial: completed, readOnly: true });
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    expect(button("定面积变形（矩形）").disabled).toBe(true);
    await pointer(shape(0), "pointerdown", 380, 270); await pointer(stage(), "pointerup", 420, 300);
    expect(current()).toEqual(completed); expect(container.textContent).not.toContain("当前几何无法保存");
  });

  it("copies partitions and repeated midpoint layers as real materials with shared undo and restore", async () => {
    const initial = setRelationFlag(createRelationsState(), "division", true), sourceId = initial.params.active;
    await render({ toolId: "plane-area-relations", initial }); await select(sourceId);
    await act(async () => button("选底与面积关系").click());
    await act(async () => button("复制当前分区为独立材料").click());
    expect(constructionObjects(current()!)).toHaveLength(3); expect(constructionObject(current()!, sourceId)).toEqual(constructionObject(initial));
    const parent = current()!, area = relationModel(parent)!.area;
    await act(async () => button("原位添加一层中点三角形").click()); expect(constructionObjects(current()!)).toHaveLength(4);
    expect(relationModel(current()!)!.area).toBeCloseTo(area / 4, 7);
    await act(async () => button("原位添加一层中点三角形").click()); expect(constructionObjects(current()!)).toHaveLength(5);
    expect(relationModel(current()!)!.area).toBeCloseTo(area / 16, 7);
    await act(async () => button("撤销").click()); expect(constructionObjects(current()!)).toHaveLength(4);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
    await render({ toolId: "plane-area-relations", initial, readOnly: true });
    expect(button("选底与面积关系").disabled).toBe(true); expect(current()).toEqual(initial);
  });

  it("publishes one exact classroom drag endpoint and does not replay it after acknowledgement", async () => {
    const initial = createPerimeterState(), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise((resolve) => { acknowledge = resolve; }));
    await render({ classroom: { state: snapshot, onChange: changed } }); await select(0);
    await act(async () => button("定面积变形（矩形）").click());
    const at = perimeterInvariantHandle(initial, "width")!.at;
    await pointer(container.querySelector('[data-perimeter-invariant-handle="width"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x + 30, at.y); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", at.x + 30, at.y);
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.motion).toBeNull(); expect(endpoint.past).toHaveLength(1);
    expect(perimeterRectangle(endpoint.current)).toMatchObject({ width: 240, height: 90 });
    await act(async () => { acknowledge!(); });
    await render({ classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(3000); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });
});
