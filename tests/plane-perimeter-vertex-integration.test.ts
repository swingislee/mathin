// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarSnapshotForTool, type PlanarPoint, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarHistory } from "@/features/tools/planar-kit/presentation";
import { createPerimeterGeometry, createPerimeterState } from "@/features/tools/plane-perimeter/model";
import { dragPerimeterVertex } from "@/features/tools/plane-perimeter/vertex-model";
import { constructionMeasurements, constructionObject, worldVertices } from "@/features/tools/plane-construction/model";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { createClassroomToolState, parseClassroomToolState } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const create = () => createPerimeterGeometry(createPerimeterState(), "polygon", [{ x: 100, y: 100 }, { x: 330, y: 130 }, { x: 350, y: 330 }, { x: 215, y: 240 }, { x: 95, y: 300 }])!;
const measure = (state: PlanarState, quantity: "area" | "perimeter") => constructionMeasurements(constructionObject(state)!)[quantity];
const label = (quantity: "area" | "perimeter") => quantity === "area" ? "定面积调顶点" : "定周长调顶点";
let container: HTMLDivElement, root: Root, time: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
let matrix: { a: number; b: number; c: number; d: number; e: number; f: number };
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const shape = (id: number) => container.querySelector<SVGGElement>(`g[data-construction-object="${id}"] > g[role="button"]`)!;
const handle = (index: number) => container.querySelector<SVGGElement>(`[data-perimeter-vertex-handle="${index}"]`)!;
const client = (point: PlanarPoint, transform = matrix) => ({ x: transform.a * point.x + transform.c * point.y + transform.e, y: transform.b * point.x + transform.d * point.y + transform.f });
async function pointer(target: Element, type: string, at: PlanarPoint, overrides: Record<string, unknown> = {}) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: at.x, clientY: at.y, pointerId: 1, isPrimary: true, button: 0, ...overrides })));
}
async function click(name: string) { await act(async () => button(name).click()); }
async function tick(ms: number) {
  time += ms; const callbacks = [...frames.values()]; frames.clear(); await act(async () => callbacks.forEach((frame) => frame(time)));
}
async function render(props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-perimeter", version: "plane-perimeter-lesson-v2", locale: "zh", onSnapshot: capture, ...props })));
}
async function select(id = 1) {
  const at = client(constructionObject(current()!, id)!.center);
  await pointer(shape(id), "pointerdown", at); await pointer(stage(), "pointerup", at);
}

describe("single-vertex editing through the shared planar workbench", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); time = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
    matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    vi.spyOn(Date, "now").mockImplementation(() => time);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const originalCrypto = crypto;
    vi.stubGlobal("crypto", { getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto) });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => matrix },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(["area", "perimeter"] as const)("changes one vertex at fixed %s, undo/restores and closes back into ordinary edit", async (quantity: "area" | "perimeter") => {
    const polygon = create(), initial = { ...polygon, flags: { ...polygon.flags, edit: true, measures: true, snap: true } };
    await render({ initial }); await select(); await click(label(quantity));
    expect(container.querySelectorAll("[data-perimeter-vertex-handle]")).toHaveLength(5);
    expect(container.querySelectorAll("[data-construction-edit-handle]")).toHaveLength(0);
    const at = worldVertices(constructionObject(initial)!)[3], end = { x: at.x + 28, y: at.y - 19 };
    await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", end); expect(current()).toBeNull();
    await pointer(stage(), "pointerup", end);
    const result = current()!, expected = dragPerimeterVertex(initial, `invariant-vertex.${quantity}.1.3`, { x: 28, y: -19 });
    expect(result).toEqual(expected); expect(measure(result, quantity)).toBeCloseTo(measure(initial, quantity), 7);
    expect(constructionObject(result, 0)).toEqual(constructionObject(initial, 0));
    await click("关闭面板"); expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull();
    expect(container.querySelectorAll("[data-construction-edit-handle]")).toHaveLength(5); expect(container.textContent).toContain("u²");
    await click("撤销"); expect(current()).toEqual(initial);
    await click("重做"); expect(current()).toEqual(result);
    const ordinary = container.querySelector('[data-construction-edit-handle="vertex.1.3"]')!, before = worldVertices(constructionObject(result)!)[3];
    await pointer(ordinary, "pointerdown", before); await pointer(stage(), "pointermove", { x: before.x + 30, y: before.y + 30 });
    await pointer(stage(), "pointerup", { x: before.x + 30, y: before.y + 30 });
    expect(measure(current()!, quantity)).not.toBeCloseTo(measure(result, quantity), 5);
    await click("恢复备好的起点"); expect(current()).toEqual(initial); expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("freezes the screen matrix and resolves the actual handle through rotated/reflected local coordinates", async () => {
    const polygon = create(), initial = { ...polygon, params: { ...polygon.params, "angle.1": 37, "flip.1": -1 }, flags: { ...polygon.flags, snap: true } };
    matrix = { a: 1.5, b: 0.2, c: -0.3, d: 1.2, e: 42, f: -17 };
    await render({ initial }); await select(); await click(label("perimeter"));
    const locked = { ...matrix }, at = worldVertices(constructionObject(initial)!)[3], end = { x: at.x + 34, y: at.y - 20 };
    await pointer(handle(3), "pointerdown", client(at, locked));
    matrix = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    await pointer(stage(), "pointermove", client(end, locked)); await pointer(stage(), "pointerup", client(end, locked));
    const expected = dragPerimeterVertex(initial, "invariant-vertex.perimeter.1.3", { x: 34, y: -20 });
    const point = constructionObject(current()!)!.vertices[3], exact = constructionObject(expected)!.vertices[3];
    expect(point.x).toBeCloseTo(exact.x, 8); expect(point.y).toBeCloseTo(exact.y, 8); expect(measure(current()!, "perimeter")).toBeCloseTo(measure(initial, "perimeter"), 7);
    expect(constructionObject(current()!, 0)).toEqual(constructionObject(initial, 0));
  });

  it("cancels without history on pointer cancellation, lost capture, second touch, blur and panel close", async () => {
    const initial = create(); await render({ initial }); await select(); await click(label("area"));
    const at = worldVertices(constructionObject(initial)!)[3], end = { x: at.x + 25, y: at.y + 20 };
    const cancellations = [
      () => pointer(stage(), "pointercancel", end),
      () => pointer(stage(), "lostpointercapture", end),
      () => pointer(stage(), "pointerdown", end, { pointerId: 2, isPrimary: false }),
      () => act(async () => { window.dispatchEvent(new Event("blur")); }),
      () => click("关闭面板"),
    ];
    for (const cancel of cancellations) {
      await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", end); expect(current()).toBeNull();
      await cancel(); expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
      await pointer(stage(), "pointerup", end); expect(current()).toEqual(initial);
    }
    expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull();
    await click(label("area")); await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", end);
    await act(async () => stage().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(initial); expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull(); expect(button("撤销").disabled).toBe(true);
  });

  it("treats threshold taps, a return to start, operation toggles and revoked write access as non-edits", async () => {
    const initial = create(); await render({ initial }); await select(); await click(label("perimeter"));
    const at = worldVertices(constructionObject(initial)!)[3];
    await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointerup", { x: at.x + 1, y: at.y + 1 });
    expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", { x: at.x + 20, y: at.y - 10 });
    await pointer(stage(), "pointermove", at); await pointer(stage(), "pointerup", at);
    expect(current()).toEqual(initial); expect(button("撤销").disabled).toBe(true);
    await click(label("perimeter")); expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull();
    await click(label("perimeter")); await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", { x: at.x + 20, y: at.y - 10 });
    await render({ initial, readOnly: true }); expect(current()).toEqual(initial); expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull();
    await pointer(stage(), "pointerup", { x: at.x + 20, y: at.y - 10 }); expect(current()).toEqual(initial); expect(button(label("perimeter")).disabled).toBe(true);
  });

  it.each(["area", "perimeter"] as const)("saves %s endpoint with v2 history, immutable copies and classroom replay without new fields", (quantity: "area" | "perimeter") => {
    const initial = create(), source = parseToolScene({ toolId: "plane-perimeter", contentVersion: "plane-perimeter-lesson-v2", payload: { title: "Single point", initial } });
    const frozen = freezeToolScene(source), saved = JSON.stringify(frozen);
    const endpoint = dragPerimeterVertex(initial, `invariant-vertex.${quantity}.1.3`, { x: 27, y: -19 });
    const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint);
    expect(planarSnapshotForTool("plane-perimeter", "plane-perimeter-lesson-v2").safeParse(snapshot).success).toBe(true);
    expect(snapshot.motion).toBeNull(); expect(snapshot.past).toEqual([initial]);
    expect(parseToolScene({ ...source, payload: { title: "Endpoint", initial: endpoint } }).payload).toMatchObject({ initial: endpoint });
    const event = createClassroomToolState("page", "doc", "instance", { toolId: "plane-perimeter", contentVersion: "plane-perimeter-lesson-v2", state: snapshot }, toolSceneOriginHash(frozen.payload));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(planarHistory(snapshot, "undo").current).toEqual(initial); expect(planarHistory(planarHistory(snapshot, "undo"), "redo").current).toEqual(endpoint);
    expect(JSON.stringify(frozen)).toBe(saved); expect(Object.keys(endpoint.params)).toEqual(Object.keys(initial.params));
  });

  it.each(["area", "perimeter"] as const)("publishes only one %s endpoint and keeps acknowledgement/late join from replaying a drag", async (quantity: "area" | "perimeter") => {
    const initial = create(), snapshot = planarSnapshot(initial);
    let acknowledge: (() => void) | undefined;
    const changed = vi.fn<(_: PlanarSnapshot) => Promise<void>>(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await render({ initial, classroom: { state: snapshot, onChange: changed } }); await select(); await click(label(quantity));
    const at = worldVertices(constructionObject(initial)!)[3], end = { x: at.x + 27, y: at.y - 19 };
    await pointer(handle(3), "pointerdown", at); await pointer(stage(), "pointermove", { x: at.x + 12, y: at.y - 8 });
    await pointer(stage(), "pointermove", end); expect(changed).not.toHaveBeenCalled();
    await pointer(stage(), "pointerup", end); expect(changed).toHaveBeenCalledTimes(1);
    const endpoint = changed.mock.calls[0][0]; expect(endpoint.motion).toBeNull(); expect(endpoint.past).toEqual([initial]);
    expect(measure(endpoint.current, quantity)).toBeCloseTo(measure(initial, quantity), 7); expect(constructionObject(endpoint.current, 0)).toEqual(constructionObject(initial, 0));
    await act(async () => { acknowledge!(); }); await render({ initial, classroom: { state: endpoint, onChange: changed } });
    expect(current()).toEqual(endpoint.current); await tick(2500); expect(current()).toEqual(endpoint.current); expect(changed).toHaveBeenCalledTimes(1);
    await render({ initial, locale: "en", classroom: { state: endpoint } }); expect(current()).toEqual(endpoint.current);
    expect(container.querySelector("[data-perimeter-vertex-handle]")).toBeNull(); expect(button("Move a vertex at fixed perimeter").disabled).toBe(true);
    await tick(2500); expect(current()).toEqual(endpoint.current);
  });
});
