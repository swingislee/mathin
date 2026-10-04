// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame } from "@/features/tools/planar-kit/presentation";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { constructionArea, constructionMeasurements, constructionObject, constructionObjects } from "@/features/tools/plane-construction/model";
import { createPerimeterGeometry, createPerimeterState, perimeterInvariantHandle, perimeterRectangle, perimeterStretchFrame } from "@/features/tools/plane-perimeter/model";
import { createRelationsState, relationModel, setRelationFlag } from "@/features/tools/plane-relations/model";
import { createInteriorState, interiorModel, toggleInterior } from "@/features/tools/plane-relations/interior-model";
import { angleComparison, angleTriangle, copyAngleTriangle, setAngleLength } from "@/features/tools/plane-relations/angle-model";

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
      expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === toolId).map((entry) => entry.contentVersion)).toEqual([PLANAR_TOOLS.find((tool) => tool.id === toolId)!.version]);
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
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-perimeter", locale: "zh", onSnapshot: capture, ...(props.toolId === "plane-area-relations" && !props.initial ? { version: "plane-area-relations-lesson-v3" as const } : {}), ...props })));
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

  it("offers v3 interior geometry while preserving v1/v2 copies, frozen starts and classroom replay", () => {
    const definition = planarScene("18-interior"), initial = toggleInterior(definition.create());
    const scene = parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Interior", initial } });
    const frozen = freezeToolScene(scene), saved = JSON.stringify(frozen);
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === "plane-area-relations").map((entry) => entry.contentVersion)).toEqual([PLANAR_TOOLS.find((tool) => tool.id === "plane-area-relations")!.version]);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const rotate = definition.operations!.flatMap((operation) => operation.actions ?? []).find((action) => action.id === "construction-rotate")!;
    const endpoint = rotate.run(initial, { selected: `object.${initial.params.active}` });
    const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, { id: rotate.id, duration: rotate.duration!, now: 100 });
    expect(planarSnapshotForTool("plane-area-relations", "plane-area-relations-lesson-v3").safeParse(snapshot).success).toBe(true);
    expect(planarSnapshotForTool("plane-area-relations", "plane-area-relations-lesson-v2").safeParse(snapshot).success).toBe(false);
    const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", state: snapshot }, toolSceneOriginHash(frozen.payload));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(planarFrame(snapshot, definition, 350)).toEqual(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 350));
    expect(interiorModel(planarFrame(snapshot, definition, 350))!.area).toBeCloseTo(interiorModel(initial)!.area, 7);
    expect(JSON.stringify(frozen)).toBe(saved);
    for (const version of ["plane-area-relations-lesson-v1", "plane-area-relations-lesson-v2"] as const) for (const legacy of scenesForPlanarTool("plane-area-relations", version)) {
      expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Historical", initial: legacy.create() } })).not.toThrow();
      expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: version, payload: { title: "Foreign", initial } })).toThrow();
    }
  });

  it("edits and drags interior P with cancellation, exact save, copied pieces, undo and panel exit", async () => {
    await render({ toolId: "plane-area-relations" }); const initial = current()!, id = initial.params.active;
    expect(initial.sceneId).toBe("18-interior"); await select(id);
    await act(async () => button("内点与两翼").click());
    await act(async () => button("显示内点与四个分区").click());
    const input = container.querySelector<HTMLInputElement>('input[aria-label="内点的高度比例"]')!;
    await act(async () => { input.value = "0.65"; input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(interiorModel(current()!)!.v).toBe(0.65);
    const before = current()!, at = interiorModel(before)!.point;
    const handle = () => container.querySelector('[data-interior-point="P"]')!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 24, at.y + 15); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", at.x + 24, at.y + 15); expect(current()).toEqual(before);
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 24, at.y + 15); await pointer(stage(), "pointerup", at.x + 24, at.y + 15);
    expect(interiorModel(current()!)!.point.x).toBeCloseTo(at.x + 24, 8); expect(interiorModel(current()!)!.point.y).toBeCloseTo(at.y + 15, 8);
    await act(async () => button("复制当前分区为独立材料").click()); expect(constructionObjects(current()!)).toHaveLength(5);
    await act(async () => button("撤销").click()); expect(constructionObjects(current()!)).toHaveLength(1);
    await act(async () => button("关闭面板").click()); expect(handle().getAttribute("role")).toBeNull(); expect(container.querySelectorAll("[data-interior-part]")).toHaveLength(4);
    await act(async () => button("内点与两翼").click());
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(handle().getAttribute("role")).toBeNull();
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
    await render({ toolId: "plane-area-relations", initial: before, readOnly: true }); expect(handle().getAttribute("role")).toBeNull(); expect(button("内点与两翼").disabled).toBe(true);
  });

  it("sends only the exact interior endpoint and keeps an acknowledged display from replaying the drag", async () => {
    const initial = toggleInterior(createInteriorState()), snapshot = planarSnapshot(initial), id = initial.params.active;
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise((resolve) => { acknowledge = resolve; }));
    await render({ toolId: "plane-area-relations", initial, classroom: { state: snapshot, onChange: changed } }); await select(id);
    await act(async () => button("内点与两翼").click()); const at = interiorModel(initial)!.point;
    await pointer(container.querySelector('[data-interior-point="P"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x + 25, at.y - 20); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", at.x + 25, at.y - 20); expect(changed).toHaveBeenCalledTimes(1);
    const endpoint = changed.mock.calls[0][0]; expect(endpoint.motion).toBeNull(); expect(endpoint.past).toHaveLength(1);
    expect(interiorModel(endpoint.current)!.point.x).toBeCloseTo(at.x + 25, 8);
    await act(async () => { acknowledge!(); }); await render({ toolId: "plane-area-relations", initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(2000); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps split, remainder and separation results within the existing v3 save and classroom contract", () => {
    const definition = planarScene("18-interior"), initial = toggleInterior(definition.create());
    const prepared = parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Common and remaining parts", initial } });
    const frozen = freezeToolScene(prepared), saved = JSON.stringify(frozen);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    for (const id of ["relations-split-common", "relations-separate-common", "relations-keep-wings"]) {
      const action = definition.operations!.flatMap((operation) => operation.actions ?? []).find((entry) => entry.id === id)!;
      const result = action.run(initial, { selected: `object.${initial.params.active}` });
      const snapshot = planarCommit(planarSnapshot(initial), initial, result, action.duration ? { id, duration: action.duration, now: 100 } : undefined);
      expect(planarSnapshotForTool("plane-area-relations", "plane-area-relations-lesson-v3").safeParse(snapshot).success).toBe(true);
      expect(snapshot.past).toEqual([initial]);
      expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Result", initial: result } })).not.toThrow();
      const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", state: snapshot }, toolSceneOriginHash(frozen.payload));
      expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
      if (snapshot.motion) {
        expect(snapshot.motion.id).toMatch(/^[a-f0-9-]{36}$/);
        expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 500)).toEqual(planarFrame(snapshot, definition, 500));
        expect(planarFrame(snapshot, definition, 2000)).toEqual(result);
      }
    }
    expect(JSON.stringify(frozen)).toBe(saved);
  });

  it("selects and moves a real split piece, then restores the whole source with shared history", async () => {
    const initial = toggleInterior(createInteriorState()), id = initial.params.active;
    await render({ toolId: "plane-area-relations", initial }); await select(id);
    await act(async () => button("内点与两翼").click());
    await act(async () => button("拆成共同片与两翼").click());
    const split = current()!, common = constructionObject(split)!;
    expect(constructionObjects(split)).toHaveLength(3); expect(constructionObject(split, id)).toBeNull();
    expect(shape(common.id).getAttribute("aria-pressed")).toBe("true"); expect(container.querySelector("[data-interior-point]")).toBeNull();
    await pointer(shape(common.id), "pointerdown", common.center.x, common.center.y);
    await pointer(stage(), "pointermove", common.center.x + 40, common.center.y + 30);
    await pointer(stage(), "pointerup", common.center.x + 40, common.center.y + 30);
    expect(constructionObject(current()!)!.center).toEqual({ x: common.center.x + 40, y: common.center.y + 30 });
    constructionObjects(split).slice(1).forEach((piece) => expect(constructionObject(current()!, piece.id)).toEqual(piece));
    await act(async () => button("撤销").click()); expect(current()).toEqual(split);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await act(async () => button("只保留两翼余片").click()); expect(constructionObjects(current()!)).toHaveLength(2);
    expect(constructionObjects(current()!).reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(interiorModel(initial)!.area * (1 - interiorModel(initial)!.v), 7);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
    await render({ toolId: "plane-area-relations", initial, readOnly: true });
    expect(button("内点与两翼").disabled).toBe(true); expect(button("移开共同片").disabled).toBe(true);
    await act(async () => button("只保留两翼余片").click()); expect(current()).toEqual(initial);
  });

  it("pauses and continues a rigid common-piece separation with conserved area and one undo", async () => {
    const initial = toggleInterior(createInteriorState()), id = initial.params.active, total = interiorModel(initial)!.area;
    await render({ toolId: "plane-area-relations", initial }); await select(id);
    await act(async () => button("内点与两翼").click()); await act(async () => button("移开共同片").click());
    expect(current()).toBeNull(); await tick(500); await act(async () => button("暂停过程").click());
    const paused = current()!, common = constructionObject(paused)!;
    expect(constructionObjects(paused)).toHaveLength(3);
    expect(constructionObjects(paused).reduce((sum, piece) => sum + constructionArea(piece.vertices), 0)).toBeCloseTo(total, 7);
    expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Paused pieces", initial: paused } })).not.toThrow();
    await act(async () => button("继续过程").click()); await tick(901);
    const completed = current()!;
    expect(constructionObject(completed)!.center.y).toBeGreaterThan(common.center.y);
    expect(constructionObject(completed)!.vertices).toEqual(common.vertices);
    constructionObjects(paused).slice(1).forEach((piece) => expect(constructionObject(completed, piece.id)).toEqual(piece));
    expect(container.textContent).not.toContain("当前几何无法保存");
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("publishes one separation endpoint and the acknowledged classroom display keeps its original time anchor", async () => {
    const initial = toggleInterior(createInteriorState()), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise((resolve) => { acknowledge = resolve; }));
    await render({ toolId: "plane-area-relations", initial, classroom: { state: snapshot, onChange: changed } }); await select(initial.params.active);
    await act(async () => button("内点与两翼").click()); await act(async () => button("移开共同片").click());
    expect(changed).toHaveBeenCalledTimes(1);
    const endpoint = changed.mock.calls[0][0]; expect(endpoint.past).toEqual([initial]);
    expect(endpoint.motion?.actionId).toBe("relations-separate-common"); expect(constructionObjects(endpoint.current)).toHaveLength(3);
    await tick(1600); await act(async () => { acknowledge!(); });
    await render({ toolId: "plane-area-relations", initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(2000); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps common-angle copies, ray edits and scaling in the existing v3 frozen and classroom contracts", () => {
    const definition = planarScene("18-interior"), initial = copyAngleTriangle(definition.create());
    const prepared = parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Common angle", initial } });
    const frozen = freezeToolScene(prepared), saved = JSON.stringify(frozen);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    for (const id of ["relations-copy-nested-angle", "relations-copy-hourglass", "relations-align-similar", "relations-scale-half", "relations-scale-double"]) {
      const start = id === "relations-align-similar" ? setAngleLength(initial, "independent", "b", angleTriangle(initial)!.bLength * 0.7) : initial;
      const action = definition.operations!.flatMap((operation) => operation.actions ?? []).find((entry) => entry.id === id)!;
      const endpoint = action.run(start, { selected: `object.${start.params.active}` }); expect(endpoint).not.toBe(start);
      const snapshot = planarCommit(planarSnapshot(start), start, endpoint, action.duration ? { id, duration: action.duration, now: 100 } : undefined);
      expect(snapshot.past).toEqual([start]); expect(planarSnapshotForTool("plane-area-relations", "plane-area-relations-lesson-v3").safeParse(snapshot).success).toBe(true);
      expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Result", initial: endpoint } })).not.toThrow();
      const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", state: snapshot }, toolSceneOriginHash(frozen.payload));
      expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
      if (snapshot.motion) {
        expect(snapshot.motion.id).toMatch(/^[a-f0-9-]{36}$/);
        expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 500)).toEqual(planarFrame(snapshot, definition, 500));
        expect(planarFrame(snapshot, definition, 2000)).toEqual(endpoint);
      }
    }
    expect(JSON.stringify(frozen)).toBe(saved);
  });

  it("selects the added common-angle copy and uses independent ray inputs and cancellable handles", async () => {
    const initial = createInteriorState(), sourceId = initial.params.active;
    await render({ toolId: "plane-area-relations", initial }); await select(sourceId);
    await act(async () => button("共角分别调边").click()); await act(async () => button("添加同向共角副本").click());
    const copied = current()!, id = copied.params.active;
    expect(constructionObjects(copied)).toHaveLength(2); expect(shape(id).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll("[data-angle-handle]")).toHaveLength(2);
    const field = container.querySelector<HTMLInputElement>('input[aria-label="OA 长度（u）"]')!;
    await act(async () => { field.value = "123"; field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(angleTriangle(current()!)!.aLength).toBeCloseTo(123, 8); expect(angleComparison(current()!)!.parallel).toBe(false);
    const before = current()!, model = angleTriangle(before)!, at = model.b;
    const end = { x: at.x + (at.x - model.origin.x) * 0.2, y: at.y + (at.y - model.origin.y) * 0.2 };
    const handle = () => container.querySelector('[data-angle-handle="b"]')!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", end.x, end.y); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", end.x, end.y); expect(current()).toEqual(before);
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", end.x, end.y); await pointer(stage(), "pointerup", end.x, end.y);
    expect(angleTriangle(current()!)!.bLength).toBeCloseTo(model.bLength * 1.2, 8); expect(angleTriangle(current()!)!.aLength).toBeCloseTo(123, 8);
    expect(constructionObject(current()!, sourceId)).toEqual(constructionObject(initial));
    await act(async () => button("撤销").click()); expect(current()).toEqual(before);
    await act(async () => button("关闭面板").click()); expect(container.querySelector("[data-angle-handle]")).toBeNull();
    await act(async () => button("共角分别调边").click()); await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("[data-angle-handle]")).toBeNull(); expect(current()).toEqual(before);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });

  it("pauses and resumes scaling about O, saves the legal intermediate geometry and undoes once", async () => {
    const initial = copyAngleTriangle(createInteriorState(), true), before = angleTriangle(initial)!;
    await render({ toolId: "plane-area-relations", initial }); await select(initial.params.active);
    await act(async () => button("定点等比伸缩").click()); await act(async () => button("两边缩为一半").click());
    expect(current()).toBeNull(); await tick(500); await act(async () => button("暂停过程").click());
    const paused = current()!, model = angleTriangle(paused)!;
    expect(model.aLength).toBeLessThan(before.aLength); expect(model.aLength).toBeGreaterThan(before.aLength / 2);
    expect(model.origin.x).toBeCloseTo(before.origin.x, 8); expect(model.origin.y).toBeCloseTo(before.origin.y, 8);
    expect(model.area / before.area).toBeCloseTo((model.aLength / before.aLength) ** 2, 8);
    expect(() => parseToolScene({ toolId: "plane-area-relations", contentVersion: "plane-area-relations-lesson-v3", payload: { title: "Paused similar triangle", initial: paused } })).not.toThrow();
    await act(async () => button("继续过程").click()); await tick(901);
    const completed = current()!; expect(angleTriangle(completed)!.area).toBeCloseTo(before.area / 4, 7);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await render({ toolId: "plane-area-relations", initial: completed, readOnly: true });
    expect(button("定点等比伸缩").disabled).toBe(true); const grow = button("两边放大一倍"); expect(!grow || grow.disabled).toBe(true);
    expect(container.querySelector("[data-angle-handle]")).toBeNull(); await act(async () => grow?.click()); expect(current()).toEqual(completed);
  });

  it("publishes one linked-ray endpoint, then keeps the acknowledged geometry without replaying a drag", async () => {
    const initial = copyAngleTriangle(createInteriorState()), snapshot = planarSnapshot(initial), model = angleTriangle(initial)!;
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ toolId: "plane-area-relations", initial, classroom: { state: snapshot, onChange: changed } }); await select(initial.params.active);
    await act(async () => button("定点等比伸缩").click());
    const end = { x: model.a.x + (model.a.x - model.origin.x) * 0.2, y: model.a.y + (model.a.y - model.origin.y) * 0.2 };
    await pointer(container.querySelector('[data-angle-handle="a"]')!, "pointerdown", model.a.x, model.a.y);
    await pointer(stage(), "pointermove", end.x, end.y); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", end.x, end.y); expect(changed).toHaveBeenCalledTimes(1);
    const endpoint = changed.mock.calls[0][0]; expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]);
    expect(angleTriangle(endpoint.current)!.area).toBeCloseTo(model.area * 1.2 ** 2, 7);
    await act(async () => { acknowledge!(); }); await render({ toolId: "plane-area-relations", initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(2000); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });

  it("shares accurate inputs and direct deformation, cancels without saving and exits on close or Escape", async () => {
    await render(); await select(0); const initial = current()!;
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    await act(async () => button("定周长拉伸").click());
    expect(container.querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(2);
    const width = container.querySelector<HTMLInputElement>('input[aria-label="整体宽（u）"]')!;
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
    await act(async () => button("定面积拉伸").click());
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull(); expect(current()).toEqual(beforeDrag);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });

  it.each(["perimeter", "area"] as const)("stretches a rotated concave polygon at fixed %s through the shared fields and direct handles", async (quantity: "perimeter" | "area") => {
    const polygon = createPerimeterGeometry(createPerimeterState(), "polygon", [{ x: 100, y: 100 }, { x: 330, y: 130 }, { x: 350, y: 330 }, { x: 215, y: 240 }, { x: 95, y: 300 }])!;
    const initial = { ...polygon, params: { ...polygon.params, "angle.1": 32, "flip.1": -1 }, flags: { ...polygon.flags, edit: true } };
    await render({ initial }); await select(1);
    const label = quantity === "area" ? "定面积拉伸" : "定周长拉伸";
    await act(async () => button(label).click());
    expect(container.querySelectorAll("[data-perimeter-invariant-handle]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-construction-edit-handle]")).toHaveLength(0);
    expect(button(quantity === "area" ? "同面积变为正方形" : "同周长变为正方形").disabled).toBe(true);
    await act(async () => button("显示边长、周长与面积").click());
    const target = constructionMeasurements(constructionObject(current()!)!)[quantity], oldWidth = perimeterStretchFrame(current()!)!.width;
    const input = container.querySelector<HTMLInputElement>('input[aria-label="整体宽（u）"]')!;
    await act(async () => { input.value = String(oldWidth * 1.2 / 30); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(perimeterStretchFrame(current()!)!.width).toBeCloseTo(oldWidth * 1.2, 7);
    expect(constructionMeasurements(constructionObject(current()!)!)[quantity]).toBeCloseTo(target, 7);
    expect(constructionObject(current()!, 0)).toEqual(constructionObject(initial, 0));
    const before = current()!, { at, direction } = perimeterInvariantHandle(before, "height")!;
    const end = { x: at.x + direction.x * 10 - direction.y * 30, y: at.y + direction.y * 10 + direction.x * 30 };
    await pointer(container.querySelector('[data-perimeter-invariant-handle="height"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", end.x, end.y); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", end.x, end.y); expect(current()).toEqual(before);
    await pointer(container.querySelector('[data-perimeter-invariant-handle="height"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", end.x, end.y); await pointer(stage(), "pointerup", end.x, end.y);
    expect(perimeterStretchFrame(current()!)!.height).toBeCloseTo(perimeterStretchFrame(before)!.height + 20, 7);
    expect(constructionMeasurements(constructionObject(current()!)!)[quantity]).toBeCloseTo(target, 7);
    const completed = current()!;
    expect(planarSnapshotForTool("plane-perimeter", "plane-perimeter-lesson-v2").safeParse(planarSnapshot(completed)).success).toBe(true);
    await act(async () => button("关闭面板").click());
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    expect(container.querySelectorAll("[data-construction-edit-handle]")).toHaveLength(5);
    expect(container.textContent).toContain("u²");
    await act(async () => button("撤销").click()); expect(current()).toEqual(before);
    await render({ initial: completed, readOnly: true });
    expect(button(label).disabled).toBe(true); expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    expect(current()).toEqual(completed); expect(container.textContent).not.toContain("当前几何无法保存");
  });

  it("publishes one concave-polygon classroom endpoint and restores it without replaying the drag", async () => {
    const initial = createPerimeterGeometry(createPerimeterState(), "polygon", [{ x: 100, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 250 }, { x: 220, y: 190 }, { x: 100, y: 250 }])!;
    const snapshot = planarSnapshot(initial), expectedArea = constructionMeasurements(constructionObject(initial)!).area;
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(1);
    await act(async () => button("定面积拉伸").click());
    const { at } = perimeterInvariantHandle(initial, "width")!;
    await pointer(container.querySelector('[data-perimeter-invariant-handle="width"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x + 25, at.y); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", at.x + 25, at.y); expect(changed).toHaveBeenCalledTimes(1);
    const endpoint = changed.mock.calls[0][0]; expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]);
    expect(constructionMeasurements(constructionObject(endpoint.current)!).area).toBeCloseTo(expectedArea, 7);
    expect(constructionObject(endpoint.current, 0)).toEqual(constructionObject(initial, 0));
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(2500); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });

  it("pauses a same-area square animation at an exact frame and keeps a read-only display inert", async () => {
    await render(); await select(0); const initial = current()!, area = constructionMeasurements(constructionObject(initial)!).area;
    await act(async () => button("定面积拉伸").click());
    await act(async () => button("同面积变为正方形").click()); expect(current()).toBeNull();
    await tick(800); await act(async () => button("暂停过程").click());
    expect(constructionMeasurements(constructionObject(current()!)!).area).toBeCloseTo(area, 7);
    expect(perimeterRectangle(current()!)!.width).not.toBeCloseTo(perimeterRectangle(current()!)!.height, 4);
    await act(async () => button("继续过程").click()); await tick(801);
    expect(perimeterRectangle(current()!)!.width).toBeCloseTo(perimeterRectangle(current()!)!.height, 8);
    const completed = current()!;
    await render({ initial: completed, readOnly: true });
    expect(container.querySelector("[data-perimeter-invariant-handle]")).toBeNull();
    expect(button("定面积拉伸").disabled).toBe(true);
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

  it.each(["10-create", "10-boundary"])("%s publishes one exact classroom drag endpoint and does not replay it after acknowledgement", async (sceneId) => {
    const initial = planarScene(sceneId).create(), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(0);
    await act(async () => button("定面积拉伸").click());
    const at = perimeterInvariantHandle(initial, "width")!.at;
    await pointer(container.querySelector('[data-perimeter-invariant-handle="width"]')!, "pointerdown", at.x, at.y);
    await pointer(stage(), "pointermove", at.x + 30, at.y); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", at.x + 30, at.y);
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.motion).toBeNull(); expect(endpoint.past).toHaveLength(1);
    expect(perimeterRectangle(endpoint.current)).toMatchObject({ width: 240, height: 90 });
    await act(async () => { acknowledge!(); });
    await render({ initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(3000); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
  });
});
