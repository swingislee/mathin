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
import { constructionObject, constructionObjects, worldVertices } from "@/features/tools/plane-construction/model";
import { isConvexMaterial } from "@/features/tools/plane-relations/geometry";
import { concaveOverlapModel, createConcaveOverlapState, setConcaveOverlapField } from "@/features/tools/plane-overlap/concave-model";
import { isValidConcaveOverlapState } from "@/features/tools/plane-overlap/concave-validation";
import { planeOverlapConcaveCases } from "./fixtures/plane-overlap-concave-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const version = "plane-overlap-lesson-v3";
const shown = (): PlanarState => {
  const state = setConcaveOverlapField(createConcaveOverlapState(), "region", 3);
  return { ...state, flags: { ...state.flags, measures: true }, params: { ...state.params, active: state.params.pairA } };
};

describe("concave overlap versioned persistence and classroom", () => {
  it("registers v3 for insertion, accepts strict fixtures and retains every original version", () => {
    expect(PLANAR_TOOLS.find((tool) => tool.id === "plane-overlap")!.version).toBe(version);
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === "plane-overlap").map((entry) => entry.contentVersion)).toEqual([version]);
    for (const fixture of planeOverlapConcaveCases()) {
      if (fixture.accepted) expect(() => parseToolScene(fixture.scene), fixture.label).not.toThrow();
      else expect(() => parseToolScene(fixture.scene), fixture.label).toThrow();
    }
    for (const legacy of ALL_PLANAR_TOOLS.filter((tool) => tool.id === "plane-overlap" && tool.version !== version)) for (const scene of scenesForPlanarTool(legacy.id, legacy.version)) {
      const state = scene.create();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: legacy.version, payload: { title: "Historical", initial: state } })).not.toThrow();
      expect(() => parseToolScene({ toolId: legacy.id, contentVersion: version, payload: { title: "Foreign", initial: state } })).toThrow();
      expect(planarSnapshotForTool(legacy.id, legacy.version).safeParse(planarSnapshot(shown())).success).toBe(false);
    }
  });

  it("freezes exact materials and replays one semantic rotate/reflect/duplicate endpoint without randomUUID", () => {
    const definition = planarScene("33-concave"), initial = shown();
    const frozen = freezeToolScene(parseToolScene({ toolId: "plane-overlap", contentVersion: version, payload: { title: "Concave papers", initial } })), saved = JSON.stringify(frozen);
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      for (const id of ["construction-rotate", "construction-reflect", "construction-duplicate"]) {
        const action = [...definition.actions!, ...definition.operations!.flatMap((operation) => operation.actions ?? [])].find((entry) => entry.id === id)!;
        const endpoint = action.run(initial, { selected: `object.${initial.params.active}` }); expect(endpoint).not.toEqual(initial);
        const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, action.duration ? { id, duration: action.duration, now: 100 } : undefined);
        expect(planarSnapshotForTool("plane-overlap", version).safeParse(snapshot).success).toBe(true);
        expect(snapshot.past).toEqual([initial]); expect(planarHistory(snapshot, "undo").current).toEqual(initial);
        const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-overlap", contentVersion: version, state: snapshot }, toolSceneOriginHash(frozen.payload));
        expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
        expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 700)).toEqual(planarFrame(snapshot, definition, 700));
        expect(() => parseToolScene({ toolId: "plane-overlap", contentVersion: version, payload: { title: "Result", initial: endpoint } })).not.toThrow();
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
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-overlap", version, locale: "zh", onSnapshot: capture, ...props })));
};
async function select(id: number) {
  const at = constructionObject(current()!, id)!.center;
  await pointer(shape(id), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
}
async function tick(ms: number) {
  time += ms; const callbacks = [...frames.values()]; frames.clear(); await act(async () => callbacks.forEach((frame) => frame(time)));
}

describe("concave paper in the shared workbench", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("draws a concave paper on the existing stage and keeps the old pair until explicit A assignment", async () => {
    await render(); const initial = current()!;
    expect(container.querySelector("[data-overlap-region]")).toBeNull();
    await act(async () => button("绘制图形").click()); await act(async () => button("绘制画凹凸多边形纸片").click());
    for (const at of [{ x: 650, y: 180 }, { x: 830, y: 180 }, { x: 830, y: 230 }, { x: 700, y: 230 }, { x: 700, y: 350 }, { x: 650, y: 350 }]) {
      await pointer(stage(), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
    }
    expect(current()).toBeNull(); await act(async () => button("完成绘制").click()); const drawn = current()!;
    expect(constructionObjects(drawn)).toHaveLength(3); expect(isConvexMaterial(constructionObject(drawn)!.vertices)).toBe(false);
    expect(drawn.params.pairA).toBe(initial.params.pairA); expect(drawn.params.pairB).toBe(initial.params.pairB);
    await act(async () => button("关闭面板").click()); await act(async () => button("观察 A / B 交并差").click());
    await act(async () => button("当前纸片作为 A").click()); expect(current()!.params.pairA).toBe(drawn.params.active);
    expect(button("当前纸片作为 B").disabled).toBe(true);
    await act(async () => button("撤销").click()); expect(current()).toEqual(drawn);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("cancels vertex edits, commits once, and retains region/measure observations after panel exit", async () => {
    const initial = shown(); await render({ initial }); await select(initial.params.active);
    await act(async () => button("编辑当前图形").click());
    const before = current()!, id = before.params.active, at = worldVertices(constructionObject(before)!)[3];
    const handle = () => container.querySelector(`[data-construction-edit-handle="vertex.${id}.3"]`)!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 18, at.y + 12); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", at.x + 18, at.y + 12); expect(current()).toEqual(before);
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 18, at.y + 12); await pointer(stage(), "pointerup", at.x + 18, at.y + 12);
    const edited = current()!; expect(isValidConcaveOverlapState(edited)).toBe(true); expect(edited).not.toEqual(before);
    expect(concaveOverlapModel(edited)!.areaA).not.toBeCloseTo(concaveOverlapModel(before)!.areaA);
    await act(async () => button("观察 A / B 交并差").click()); await act(async () => button("关闭面板").click());
    expect(current()).toEqual(edited); expect(container.querySelector('[data-overlap-region="3"]')).not.toBeNull(); expect(container.querySelector("[data-overlap-measures]")).not.toBeNull();
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(edited); expect(container.querySelector("[data-construction-edit-handle]")).toBeNull();
    await act(async () => button("撤销").click()); expect(current()).toEqual(before);
  });

  it("keeps reflection projections unsaveable while restoring exact regions at the endpoint and undo", async () => {
    const initial = shown(); await render({ initial }); await select(initial.params.active);
    await act(async () => button("沿轴镜像").click()); await act(async () => button("翻到对称位置").click());
    expect(current()).toBeNull(); await tick(650); await act(async () => button("暂停过程").click());
    expect(current()).toBeNull(); expect(container.querySelector("[data-overlap-region]")).toBeNull();
    await act(async () => button("继续过程").click()); await tick(751);
    const completed = current()!; expect(isValidConcaveOverlapState(completed)).toBe(true); expect(container.querySelector("[data-overlap-region]")).not.toBeNull();
    expect(concaveOverlapModel(completed)!.areaA).toBeCloseTo(concaveOverlapModel(initial)!.areaA, 7);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });

  it("clears only a deleted A reference, preserves the unpaired scene and leaves read-only displays inert", async () => {
    const initial = shown(); await render({ initial }); await select(initial.params.active);
    await act(async () => button("移去当前图形").click()); const removed = current()!;
    expect(removed.params.pairA).toBe(-1); expect(removed.params.pairB).toBe(initial.params.pairB); expect(removed.params.region).toBe(3);
    await act(async () => button("添加图形或生活实例").click()); await act(async () => button("添加U 形凹纸片").click());
    const added = current()!; expect(added.params.pairA).toBe(-1); expect(constructionObjects(added)).toHaveLength(2);
    await act(async () => button("观察 A / B 交并差").click()); await act(async () => button("当前纸片作为 A").click());
    const paired = current()!; expect(paired.params.pairA).toBe(paired.params.active); expect(concaveOverlapModel(paired)).not.toBeNull();
    await render({ initial: paired, readOnly: true, locale: "en" });
    expect(button("Inspect A / B regions").disabled).toBe(true); expect(button("Reflect across an axis").disabled).toBe(true);
    expect(container.querySelector("[data-overlap-region]")).not.toBeNull(); expect(container.querySelector("[data-construction-edit-handle]")).toBeNull();
    const before = current(); await pointer(stage(), "pointerdown", 400, 320); await pointer(stage(), "pointermove", 440, 360); await pointer(stage(), "pointerup", 440, 360); expect(current()).toEqual(before);
  });

  it("publishes one exact concave vertex endpoint, preserves acknowledgement and restores on late join", async () => {
    const start = shown(), initial = { ...start, flags: { ...start.flags, edit: true } }, snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(initial.params.active);
    const at = worldVertices(constructionObject(initial)!)[3], handle = () => container.querySelector(`[data-construction-edit-handle="vertex.${initial.params.active}.3"]`)!;
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 15, at.y + 10);
    expect(changed).not.toHaveBeenCalled(); await pointer(stage(), "pointercancel", at.x + 15, at.y + 10); expect(changed).not.toHaveBeenCalled();
    await pointer(handle(), "pointerdown", at.x, at.y); await pointer(stage(), "pointermove", at.x + 15, at.y + 10); await pointer(stage(), "pointerup", at.x + 15, at.y + 10);
    expect(changed).toHaveBeenCalledTimes(1); const endpoint = changed.mock.calls[0][0];
    expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]); expect(isValidConcaveOverlapState(endpoint.current)).toBe(true);
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } }); await tick(2000);
    expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
    await render({ initial: endpoint.current, classroom: { state: JSON.parse(JSON.stringify(endpoint)) }, readOnly: true });
    expect(concaveOverlapModel(current()!)).toEqual(concaveOverlapModel(endpoint.current)); expect(container.querySelector("[data-overlap-region]")).not.toBeNull();
  });
});
