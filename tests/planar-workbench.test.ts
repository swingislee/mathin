// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "../src/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarStateSchema, type PlanarSnapshot, type PlanarState } from "../src/features/tools/planar-kit/contract";
import { planarScene } from "../src/features/tools/planar-kit/scene-registry";
import { constructionObjects } from "../src/features/tools/plane-construction/model";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
let container: HTMLDivElement, root: Root, clock: number, nextFrame: number, frames: Map<number, FrameRequestCallback>;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const svg = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const shape = () => container.querySelector<SVGPolygonElement>('polygon[aria-label="拖动图形平移"]')!;
async function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, isPrimary = true) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId, isPrimary, button: 0 })));
}
async function tick(ms: number) {
  clock += ms; const pending = [...frames.values()]; frames.clear();
  await act(async () => pending.forEach((frame) => frame(clock)));
}
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => {
  await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-motion", locale: "zh", initial: planarScene("20").create(), onSnapshot: capture, ...props })));
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clock = 1000; nextFrame = 0; frames = new Map(); capture.mockClear();
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.set(++nextFrame, frame); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 100, y: 100, left: 100, top: 100, right: 300, bottom: 120, width: 200, height: 20, toJSON: () => ({}) }));
  Object.defineProperties(SVGSVGElement.prototype, {
    getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
    setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("the shared planar workbench", () => {
  it("uses semantic controls and non-modal settings with a repeated-click exit", async () => {
    await render();
    expect(button("播放平移").dataset.spatialAction).toBe("play");
    expect(button("形状与准确参数").dataset.spatialAction).toBe("dimensions");
    expect(button("恢复备好的起点").dataset.spatialAction).toBe("reset");
    await act(async () => button("形状与准确参数").click());
    expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull();
    await act(async () => button("形状与准确参数").click());
    expect(container.querySelector("[data-cube-canvas-panel]")).toBeNull();
  });
  it("commits a direct drag once, without replaying it, and restores the prepared origin", async () => {
    const initial = { ...planarScene("20").create(), params: { dx: 120, dy: 80 }, phase: 0.5 };
    await render({ initial });
    await pointer(shape(), "pointerdown", 330, 300); await pointer(svg(), "pointermove", 430, 350);
    expect(current()).toBeNull();
    await pointer(svg(), "pointerup", 430, 350);
    expect(current()?.params).toEqual({ dx: 160, dy: 90 });
    expect(frames.size).toBe(0);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await act(async () => button("重做").click()); expect(current()?.params.dx).toBe(160);
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial);
  });
  it("cancels a second touch, lost capture, and Escape without committing a drag", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "pointerdown", 400, 350, 2, false); expect(current()).toEqual(initial);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await pointer(svg(), "lostpointercapture", 400, 350); expect(current()).toEqual(initial);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await act(async () => svg().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(initial);
  });
  it("keeps read-only and viewer instances inert", async () => {
    const initial = planarScene("20").create(); await render({ initial, readOnly: true });
    expect(button("播放平移").disabled).toBe(true);
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350); await pointer(svg(), "pointerup", 400, 350);
    expect(current()).toEqual(initial);
    await render({ initial, classroom: { state: planarSnapshot(initial) } });
    expect(button("恢复备好的起点").disabled).toBe(true);
  });
  it("pauses at the visible phase, remains still, and resumes from there", async () => {
    await render(); await act(async () => button("播放平移").click());
    await tick(900); expect(current()).toBeNull();
    await act(async () => button("暂停过程").click()); expect(current()?.phase).toBeCloseTo(0.5);
    await tick(500); expect(current()?.phase).toBeCloseTo(0.5);
    await act(async () => button("继续过程").click()); await tick(900);
    expect(current()?.phase).toBe(1); expect(frames.size).toBe(0);
  });
  it("does not replay a classroom drag when its durable receipt arrives", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial);
    let sent: PlanarSnapshot | undefined, resolve: (() => void) | undefined;
    const onChange = vi.fn((next: PlanarSnapshot) => { sent = next; return new Promise<void>((done) => { resolve = done; }); });
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 440, 330); await pointer(svg(), "pointerup", 440, 330);
    expect(onChange).toHaveBeenCalledTimes(1); expect(sent?.current.params.dx).toBe(140); expect(sent?.motion).toBeNull();
    await act(async () => resolve!());
    await render({ initial, classroom: { state: sent, onChange } });
    expect(current()?.params.dx).toBe(140); expect(frames.size).toBe(0);
    await render({ initial, classroom: { state: structuredClone(sent!), onChange } });
    expect(current()?.params.dx).toBe(140); expect(frames.size).toBe(0);
  });
  it("immediately drops a local drag preview when edit permission is revoked", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await render({ initial, readOnly: true });
    expect(current()).toEqual(initial);
    expect(shape().getAttribute("aria-disabled")).toBe("true");
  });
  it("replaces an in-progress preview when a different classroom authority arrives", async () => {
    const initial = planarScene("20").create(), onChange = vi.fn(async () => {}), snapshot = planarSnapshot(initial);
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    const replacement = planarSnapshot({ ...initial, phase: 1, params: { dx: -80, dy: 40 } });
    await render({ initial, classroom: { state: replacement, onChange } });
    expect(current()).toEqual(replacement.current);
    await pointer(svg(), "pointerup", 400, 350); expect(onChange).not.toHaveBeenCalled();
  });
  it("rolls a rejected classroom write back to the authority", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial), onChange = vi.fn(async () => { throw new Error("write failed"); });
    await render({ initial, classroom: { state: snapshot, onChange } });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 440, 330); await pointer(svg(), "pointerup", 440, 330);
    expect(current()).toEqual(initial); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(frames.size).toBe(0);
  });
  it("deselects a blank tap and does not mistake a completed object drag for one", async () => {
    await render();
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointerup", 300, 300);
    expect(shape().getAttribute("aria-pressed")).toBe("true");
    await act(async () => svg().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(shape().getAttribute("aria-pressed")).toBe("true");
    await pointer(svg(), "pointerdown", 50, 550); await pointer(svg(), "pointerup", 50, 550);
    await act(async () => svg().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(shape().getAttribute("aria-pressed")).toBe("false");
  });
  it("cancels an active object gesture when the window loses focus", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await pointer(shape(), "pointerdown", 300, 300); await pointer(svg(), "pointermove", 400, 350);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(current()).toEqual(initial);
    await pointer(svg(), "pointerup", 400, 350); expect(current()).toEqual(initial);
  });
  it("replaces an opened scene without waiting for a reset click", async () => {
    const first = planarScene("20").create(), second = { ...first, params: { dx: 60, dy: -80 }, phase: 1 };
    await render({ initial: first }); await render({ initial: second });
    expect(current()).toEqual(second);
  });
  it("snaps a fractional domino drag to a legal cell instead of rejecting the animation", async () => {
    const initial = planarScene("57").create(); await render({ toolId: "plane-covering", initial });
    const domino = container.querySelector('[aria-label="骨牌 1"]')!;
    await pointer(domino, "pointerdown", 370, 305); await pointer(svg(), "pointermove", 402, 305); await pointer(svg(), "pointerup", 402, 305);
    await tick(200);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(current()?.points.domino0).toEqual({ x: 2, y: 2 });
  });
  it("never exposes a fractional cutting frame as a prepared mathematical state", async () => {
    const initial = planarScene("14").create(); await render({ toolId: "plane-area", initial });
    await act(async () => button("沿下一条高剪开").click()); await tick(240);
    await act(async () => button("暂停过程").click());
    const captured = current(); expect(captured === null || planarStateSchema.safeParse(captured).success).toBe(true);
    await act(async () => button("选择教学现场").click());
    expect([...container.querySelectorAll<HTMLButtonElement>('[data-cube-canvas-panel] button')].filter((item) => !item.getAttribute("aria-label")).every((item) => item.disabled)).toBe(true);
    await act(async () => button("恢复备好的起点").click());
    expect(container.querySelector('[role="alert"]')).toBeNull(); expect(current()).toEqual(initial);
  });
  it("commits progress keyboard edits using the shared slider", async () => {
    await render(); await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!;
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(current()?.phase).toBeCloseTo(0.001, 6);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not submit an old slider preview over a new classroom authority", async () => {
    const initial = planarScene("20").create(), snapshot = planarSnapshot(initial), onChange = vi.fn(async () => {});
    await render({ initial, classroom: { state: snapshot, onChange } });
    await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!, track = slider.closest('[dir="ltr"]')!;
    await pointer(track, "pointerdown", 200, 110); await pointer(track, "pointermove", 250, 110);
    expect(current()).toBeNull();
    const replacement = planarSnapshot({ ...initial, phase: 0.3, params: { dx: 85, dy: 25 } });
    await render({ initial, classroom: { state: replacement, onChange } });
    await pointer(track, "pointerup", 250, 110);
    expect(onChange).not.toHaveBeenCalled(); expect(current()).toEqual(replacement.current);
  });
  it("drops a slider preview on window blur and ignores its late pointerup", async () => {
    const initial = planarScene("20").create(); await render({ initial });
    await act(async () => button("显示设置").click());
    const slider = container.querySelector('[role="slider"][aria-label="演示位置"]')!, track = slider.closest('[dir="ltr"]')!;
    await pointer(track, "pointerdown", 200, 110); await pointer(track, "pointermove", 250, 110);
    expect(current()).toBeNull();
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(current()).toEqual(initial);
    await pointer(track, "pointerup", 250, 110);
    expect(current()).toEqual(initial);
  });
});

describe("basic shapes: compose materials and capabilities on one stage", () => {
  const initial = () => planarScene("01-basic").create();
  it("adds from the right toolbar without a scene switch or replacing existing objects", async () => {
    await render({ toolId: "plane-shapes", initial: initial() });
    expect(container.querySelectorAll("[data-shape-object]")).toHaveLength(1);
    expect(button("选择教学现场")).toBeNull();
    expect(button("添加图形或生活实例").closest('[role="toolbar"]')?.getAttribute("aria-label")).toBe("操作工具");
    await act(async () => button("添加图形或生活实例").click());
    expect(container.querySelector('[data-cube-panel-anchor="tool"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button("添加三角形").click());
    expect(current()?.params.count).toBe(2);
    expect(current()?.params.kind0).toBe(2); expect(current()?.points.object0).toEqual(initial().points.object0);
    expect(container.querySelectorAll("[data-shape-object]")).toHaveLength(2);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial());
    await act(async () => button("重做").click()); expect(current()?.params.count).toBe(2);
  });
  it("composes boundary and vertex observation, preserves marked parts when adding, and drags the whole shape", async () => {
    await render({ toolId: "plane-shapes", initial: initial() });
    await act(async () => button("观察边界").click());
    await act(async () => button("观察顶点").click());
    expect(button("观察边界").getAttribute("aria-pressed")).toBe("true");
    expect(button("观察顶点").getAttribute("aria-pressed")).toBe("true");
    const edge = container.querySelector('[aria-label="长方形 · 边 1"]')!;
    await act(async () => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(current()?.marks).toEqual(["edge.0.0"]);
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加圆").click());
    expect(current()?.marks).toEqual(["edge.0.0"]);
    const body = container.querySelector('[data-shape-object="0"] [aria-label="1 · 长方形"]')!;
    await pointer(body, "pointerdown", 480, 360); await pointer(svg(), "pointermove", 530, 380); await pointer(svg(), "pointerup", 530, 380);
    expect(current()?.points.object0).toEqual({ x: 530, y: 380 });
    expect(current()?.params.kind0).toBe(2); expect(current()?.marks).toEqual(["edge.0.0"]);
    expect(frames.size).toBe(0); expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("fades a life example on the same outline, pauses, and restores the prepared material", async () => {
    await render({ toolId: "plane-shapes", initial: initial() });
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加钟面").click());
    await act(async () => button("生活实例：提取轮廓／还原细节").click());
    await tick(450);
    expect(Number(container.querySelector('[data-life-details="clock"]')?.getAttribute("opacity"))).toBeCloseTo(0.5);
    expect(container.querySelectorAll("[data-shape-object]")).toHaveLength(2);
    await act(async () => button("暂停过程").click());
    expect(current()?.params.detail1).toBeCloseTo(0.5);
    await tick(500); expect(current()?.params.detail1).toBeCloseTo(0.5);
    await act(async () => button("继续过程").click()); await tick(450);
    expect(current()?.params.detail1).toBe(0);
    expect(container.querySelector('[data-shape-kind="clock"]')).not.toBeNull();
    await act(async () => button("恢复备好的起点").click()); expect(current()).toEqual(initial());
  });
  it("allows an empty stage and reads precise fields from the current material", async () => {
    await render({ toolId: "plane-shapes", initial: initial() });
    await act(async () => button("移去当前图形").click());
    expect(current()?.params.count).toBe(0); expect(button("移去当前图形").disabled).toBe(true);
    await act(async () => button("添加图形或生活实例").click());
    await act(async () => button("添加门板正面").click());
    expect(current()?.params.kind0).toBe(9);
    await act(async () => button("当前图形顺时针 45°").click()); await tick(450);
    await act(async () => button("形状与准确参数").click());
    const values = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((input) => input.valueAsNumber);
    expect(values).toEqual([1, 45, 1]);
    expect(current()?.params).not.toHaveProperty("angle");
  });
  it("keeps materials inert for viewers and tangram independent from basic recognition", async () => {
    await render({ toolId: "plane-shapes", initial: initial(), readOnly: true });
    expect(button("添加图形或生活实例").disabled).toBe(true);
    expect(button("观察边界").disabled).toBe(true);
    await render({ toolId: "plane-tangram", initial: planarScene("02").create() });
    expect(current()?.params.count).toBe(7); expect(button("选择教学现场")).toBeNull();
    expect(button("添加图形或生活实例")).toBeNull(); expect(button("观察顶点")).toBeNull();
  });
});

describe("shared teacher-created material", () => {
  const initial = () => planarScene("01-create").create();
  const constructionRender = (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => render({ toolId: "plane-shapes", initial: initial(), ...props });
  const drawTool = async (label: string) => {
    await act(async () => button("绘制图形").click());
    await act(async () => button(`绘制${label}`).click());
  };
  it("keeps conclusions and edit handles off until explicitly requested", async () => {
    await constructionRender();
    expect(svg().textContent).not.toContain("条直边");
    expect(container.querySelector("[data-construction-edit-handle]")).toBeNull();
    await act(async () => button("显示边与顶点数量").click());
    expect(svg().textContent).toContain("4 条直边");
    await act(async () => button("显示边与顶点数量").click());
    expect(svg().textContent).not.toContain("条直边");
  });
  it("draws a rectangle over existing material without moving it and commits only on release", async () => {
    await constructionRender(); await drawTool("长方形");
    const body = container.querySelector('[data-construction-object="0"] [role="button"]')!;
    await pointer(body, "pointerdown", 350, 280); await pointer(svg(), "pointermove", 650, 480);
    expect(current()).toBeNull(); expect(container.querySelector('[data-construction-draft="true"]')).not.toBeNull();
    await pointer(svg(), "pointerup", 650, 480);
    expect(constructionObjects(current()!)).toHaveLength(2);
    expect(current()?.points["center.0"]).toEqual(initial().points["center.0"]);
    expect(constructionObjects(current()!)[1].vertices).toHaveLength(4);
    expect(container.querySelector('[data-construction-object="1"] [role="button"]')?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial());
    await act(async () => button("重做").click()); expect(constructionObjects(current()!)).toHaveLength(2);
  });
  it("keeps the edit focus and actual active material together when duplicating or removing", async () => {
    await constructionRender();
    const body = container.querySelector('[data-construction-object="0"] [role="button"]')!;
    await pointer(body, "pointerdown", 380, 340); await pointer(svg(), "pointerup", 380, 340);
    await act(async () => button("编辑当前图形").click());
    await act(async () => button("复制当前图形").click());
    expect(current()?.params.active).toBe(1);
    expect(container.querySelector('[data-construction-edit-handle="vertex.1.0"]')).not.toBeNull();
    expect(container.querySelector('[data-construction-edit-handle="vertex.0.0"]')).toBeNull();
    await act(async () => button("移去当前图形").click());
    expect(current()?.params.active).toBe(0);
    expect(container.querySelector('[data-construction-edit-handle="vertex.0.0"]')).not.toBeNull();
  });
  it("closes a teacher-defined polygon and edits its actual vertex, not a template scale", async () => {
    await constructionRender(); await drawTool("多边形");
    for (const [x, y] of [[80, 90], [270, 110], [200, 260], [100, 220]]) {
      await pointer(svg(), "pointerdown", x, y); await pointer(svg(), "pointerup", x, y);
      expect(current()).toBeNull();
    }
    await act(async () => button("完成绘制").click());
    expect(constructionObjects(current()!)).toHaveLength(2);
    const body = container.querySelector('[data-construction-object="1"] [role="button"]')!;
    await pointer(body, "pointerdown", 150, 150); await pointer(svg(), "pointerup", 150, 150);
    await act(async () => button("编辑当前图形").click());
    const before = current()!, vertex = container.querySelector('[data-construction-edit-handle="vertex.1.0"]')!;
    expect(vertex).not.toBeNull();
    await pointer(vertex, "pointerdown", 80, 90); await pointer(svg(), "pointermove", 65, 60); await pointer(svg(), "pointerup", 65, 60);
    expect(current()?.points["vertex.1.0"]).not.toEqual(before.points["vertex.1.0"]);
    expect(current()?.points["vertex.1.1"]).toEqual(before.points["vertex.1.1"]);
    expect(planarStateSchema.safeParse(current()).success).toBe(true);
  });
  it("keeps an invalid self-crossing draft out of history, and cancels pending points on Escape and blur", async () => {
    await constructionRender(); await drawTool("多边形");
    for (const [x, y] of [[100, 100], [240, 240], [100, 240], [240, 100]]) {
      await pointer(svg(), "pointerdown", x, y); await pointer(svg(), "pointerup", x, y);
    }
    await act(async () => button("完成绘制").click());
    expect(current()).toBeNull(); expect(container.querySelector('[data-cube-canvas-panel] [role="status"]')).not.toBeNull();
    await act(async () => svg().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(current()).toEqual(initial()); expect(button("撤销").disabled).toBe(true);
    await drawTool("多边形");
    await pointer(svg(), "pointerdown", 100, 100); await pointer(svg(), "pointerup", 100, 100);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(current()).toEqual(initial()); expect(svg().hasAttribute("data-drawing-tool")).toBe(false);
  });
  it("cancels drawing capture on a second touch and authority/permission replacement", async () => {
    const start = initial(); await constructionRender({ initial: start }); await drawTool("圆");
    await pointer(svg(), "pointerdown", 100, 100); await pointer(svg(), "pointermove", 180, 150);
    await pointer(svg(), "pointerdown", 200, 200, 2, false); await pointer(svg(), "pointerup", 180, 150);
    expect(current()).toEqual(start);
    await pointer(svg(), "pointerdown", 100, 100); await pointer(svg(), "pointermove", 180, 150);
    await constructionRender({ initial: start, readOnly: true });
    await pointer(svg(), "pointerup", 180, 150);
    expect(current()).toEqual(start); expect(button("绘制图形").disabled).toBe(true);
    const source = planarSnapshot(start), onChange = vi.fn(async () => {});
    await constructionRender({ initial: start, classroom: { state: source, onChange } });
    // 权限改变保留面板可见性，但绘制模式已经退出。
    if (!button("绘制多边形")) await act(async () => button("绘制图形").click());
    await act(async () => button("绘制多边形").click());
    await pointer(svg(), "pointerdown", 100, 100); await pointer(svg(), "pointerup", 100, 100);
    const replacement = planarSnapshot({ ...start, flags: { ...start.flags, grid: true } });
    await constructionRender({ initial: start, classroom: { state: replacement, onChange } });
    expect(current()).toEqual(replacement.current); expect(onChange).not.toHaveBeenCalled();
  });
  it("opens operations without replacing material and animates an actual selected object", async () => {
    const start = planarScene("20-create").create();
    await render({ toolId: "plane-motion", initial: start });
    expect(button("选择教学现场")).toBeNull();
    await act(async () => button("绕点旋转").click());
    expect(current()).toEqual(start); expect(container.querySelector('[data-construction-guide="rotate"]')).not.toBeNull();
    await act(async () => button("播放旋转").click()); await tick(700);
    expect(current()).toBeNull();
    await act(async () => button("暂停过程").click());
    expect(current()?.params["angle.0"]).not.toBe(start.params["angle.0"]);
    const halfway = current(); await tick(700); expect(current()).toEqual(halfway);
    await act(async () => button("继续过程").click()); await tick(700);
    expect(current()?.params["angle.0"]).toBe(start.params["angle.0"] + start.params.turn);
    await act(async () => button("绕点旋转").click());
    expect(container.querySelector('[data-construction-guide="rotate"]')).toBeNull();
  });
  it("opens the scissors as a drawing gesture, then releases the cut pieces for direct movement", async () => {
    const start = planarScene("14-create").create();
    await render({ toolId: "plane-area", initial: start });
    await act(async () => button("剪开纸片").click());
    expect(svg().dataset.drawingTool).toBe("cut-line");
    await pointer(svg(), "pointerdown", 480, 150); await pointer(svg(), "pointermove", 480, 590);
    expect(container.querySelector('[data-paper-cut-preview="valid"]')).not.toBeNull();
    await pointer(svg(), "pointerup", 480, 590);
    expect(svg().hasAttribute("data-drawing-tool")).toBe(false);
    expect(constructionObjects(current()!)).toHaveLength(2);
    const cut = current()!, id = cut.params.active, center = cut.points[`center.${id}`];
    const piece = container.querySelector(`[data-construction-object="${id}"] [role="button"]`)!;
    await pointer(piece, "pointerdown", center.x, center.y);
    await pointer(svg(), "pointermove", center.x + 60, center.y + 25); await pointer(svg(), "pointerup", center.x + 60, center.y + 25);
    expect(current()?.points[`center.${id}`]).toEqual({ x: center.x + 60, y: center.y + 25 });
    expect(frames.size).toBe(0); expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => button("撤销").click()); expect(current()).toEqual(cut);
    await act(async () => button("撤销").click()); expect(current()).toEqual(start);
  });
  it("adds network nodes on a tap, not on a drag, and leaves drawing before tracing", async () => {
    const start = planarScene("52-create").create();
    await render({ toolId: "plane-graph-path", initial: start });
    await drawTool("加一个点");
    await pointer(svg(), "pointerdown", 90, 90); await pointer(svg(), "pointermove", 180, 90); await pointer(svg(), "pointerup", 180, 90);
    expect(current()).toEqual(start);
    await pointer(svg(), "pointerdown", 90, 90); await pointer(svg(), "pointerup", 90, 90);
    expect(Object.values(current()!.points)).toContainEqual({ x: 90, y: 90 });
    expect(Object.keys(current()!.points)).toHaveLength(Object.keys(start.points).length + 1);
    await act(async () => button("关闭面板").click());
    expect(svg().hasAttribute("data-drawing-tool")).toBe(false);
    const node = container.querySelector('[aria-label="节点 1"]')!;
    await pointer(node, "pointerdown", start.points["node.0"].x, start.points["node.0"].y);
    await pointer(svg(), "pointerup", start.points["node.0"].x, start.points["node.0"].y);
    expect(current()?.marks.some((mark) => mark.startsWith("stroke."))).toBe(true);
    expect(planarStateSchema.safeParse(current()).success).toBe(true);
  });
  it("keeps cutting tools unavailable until folded, then exits after a valid crease", async () => {
    const start = planarScene("32-create").create();
    await render({ toolId: "plane-folding", initial: start });
    await act(async () => button("绘制图形").click());
    expect(button("绘制圆形剪口").disabled).toBe(true);
    await act(async () => button("绘制折痕").click());
    await pointer(svg(), "pointerdown", 480, 100); await pointer(svg(), "pointermove", 480, 600); await pointer(svg(), "pointerup", 480, 600);
    expect(current()?.params.creaseSet).toBe(1);
    expect(svg().hasAttribute("data-drawing-tool")).toBe(false);
    expect(button("慢慢折合").disabled).toBe(false);
    await act(async () => button("慢慢折合").click()); await tick(900);
    await act(async () => button("暂停过程").click());
    expect(current()?.phase).toBeCloseTo(0.5);
    expect(planarStateSchema.safeParse(current()).success).toBe(true);
    expect(button("绘制圆形剪口").disabled).toBe(true);
    await act(async () => button("继续过程").click()); await tick(900);
    expect(current()?.phase).toBe(1); expect(button("绘制圆形剪口").disabled).toBe(false);
  });
});
