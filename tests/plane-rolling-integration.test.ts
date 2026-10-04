// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool, type PlanarSnapshot, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { freezeToolScene, parseToolScene, toolSceneSchema } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createRollingWorkbenchState, rollingPair, rollingPose, rollingToStage, setRollingField } from "@/features/tools/plane-rolling-workbench/model";
import { isValidRollingWorkbenchState } from "@/features/tools/plane-rolling-workbench/validation";
import { planeRollingCases } from "./fixtures/plane-rolling-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));
const version = "plane-rolling-lesson-v2" as NonNullable<ComponentProps<typeof PlanarWorkbench>["version"]>;

describe("rolling v2 after shared registration", () => {
  it("exposes new construction and keeps v1 readable but isolated from v2", () => {
    expect(PLANAR_TOOLS.find((tool) => tool.id === "plane-rolling")?.version).toBe(version);
    expect(planarScene("55-create").create()).toEqual(createRollingWorkbenchState());
    for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === "plane-rolling").map((entry) => entry.contentVersion)).toEqual([version]);
    const legacy = scenesForPlanarTool("plane-rolling", "plane-rolling-lesson-v1")[0].create();
    expect(planarSnapshotForTool("plane-rolling", version).safeParse({ ...planarSnapshot(createRollingWorkbenchState()), past: [legacy] }).success).toBe(false);
  });
  it("accepts TS/SQL fixtures and freezes detached accurate geometry", () => {
    for (const entry of planeRollingCases()) {
      expect(toolSceneSchema.safeParse(entry.scene).success, entry.label).toBe(entry.accepted);
      if (entry.accepted) { const frozen = freezeToolScene(parseToolScene(entry.scene)), before = JSON.stringify(frozen); entry.scene.payload.initial.points.extra = { x: 1, y: 2 }; expect(JSON.stringify(frozen)).toBe(before); }
    }
  });
});

let container: HTMLDivElement, root: Root, now: number;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const body = (id = 0) => container.querySelector<SVGGElement>(`[data-rolling-body="${id}"]`)!;
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => { await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-rolling", version, locale: "zh", onSnapshot: capture, ...props }))); };
async function pointer(target: Element, type: string, x: number, y: number, pointerId = 1, isPrimary = true) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId, isPrimary, button: 0 })));
}
const pointAt = (state: PlanarState, angle: number) => rollingToStage(rollingPose({ ...rollingPair(state)!, angle }).center, state);
async function rollGesture(initial: PlanarState, angles: number[], finish = "pointerup") {
  const down = pointAt(initial, rollingPair(initial)!.angle); await pointer(body(initial.params.active), "pointerdown", down.x, down.y);
  for (const angle of angles) { const at = pointAt(initial, angle); await pointer(stage(), "pointermove", at.x, at.y); }
  const at = pointAt(initial, angles.at(-1)!); await pointer(stage(), finish, at.x, at.y);
}
async function selectPair(id = 0) { const target = container.querySelector<SVGGElement>(`[data-rolling-label="${id}"]`)!; await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))); }

describe("rolling direct manipulation in the real shared host", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); capture.mockClear(); now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("rolls backward from zero and through more than one turn, with one undo per gesture", async () => {
    await render(); const initial = current()!;
    await rollGesture(initial, [-60, -120, -180, -240, -300, -360, -420]); expect(rollingPair(current()!)!.angle).toBeCloseTo(-420, 8);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await rollGesture(initial, Array.from({ length: 13 }, (_, i) => (i + 1) * 60)); expect(rollingPair(current()!)!.angle).toBeCloseTo(780, 8);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("cancels a live gesture and lets direct center movement preserve accumulated spin", async () => {
    const initial = setRollingField(createRollingWorkbenchState(), "angle", 721.25); await render({ initial });
    await rollGesture(initial, [770, 830], "pointercancel"); expect(current()).toEqual(initial);
    const pair = container.querySelector<SVGGElement>('[aria-label="搬动圆对 1"]')!, c = rollingToStage(rollingPair(initial)!.center, initial);
    await pointer(pair, "pointerdown", c.x, c.y); await pointer(stage(), "pointermove", c.x + 30, c.y + 20); expect(current()).toBeNull(); await pointer(stage(), "pointerup", c.x + 30, c.y + 20);
    expect(rollingPair(current()!)!.angle).toBe(721.25); expect(rollingPair(current()!)!.center).not.toEqual(rollingPair(initial)!.center);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("accepts precise radii, hides operation handles on close and retains requested observations", async () => {
    await render(); await selectPair(); await act(async () => button("半径与内外滚动").click());
    expect(container.querySelectorAll("[data-rolling-handle]")).toHaveLength(2);
    const R = container.querySelector<HTMLInputElement>('input[aria-label="固定圆半径 R（u）"]')!; expect(R.getAttribute("step")).toBe("any");
    await act(async () => { R.value = "5.123456789"; R.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); expect(rollingPair(current()!)!.R).toBe(5.123456789);
    await act(async () => button("关闭面板").click()); expect(container.querySelector("[data-rolling-handle]")).toBeNull();
    await act(async () => button("当前圆对的观察").click()); await act(async () => button("显示圆心绕行轨道").click()); await act(async () => button("关闭面板").click()); expect(container.querySelector('[data-rolling-orbit="0"]')).not.toBeNull();
    await act(async () => button("复制当前圆对").click()); expect(container.querySelectorAll("[data-rolling-pair]")).toHaveLength(2); expect(rollingPair(current()!, 0)!.R).toBe(5.123456789);
  });
  it("pauses and resumes an actual circular semantic path, keeping the paused frame saveable", async () => {
    await render({ initial: setRollingField(createRollingWorkbenchState(), "rollBy", -720.5) }); await selectPair();
    await act(async () => button("累计绕行与相对播放").click()); await act(async () => button("从当前位置按设定角度滚动").click()); expect(current()).toBeNull();
    now = 1450; await act(async () => button("暂停过程").click()); expect(rollingPair(current()!)!.angle).toBeCloseTo(-180.125); expect(isValidRollingWorkbenchState(current())).toBe(true);
    now = 2000; await act(async () => button("继续过程").click()); now = 2450; await act(async () => button("暂停过程").click()); expect(rollingPair(current()!)!.angle).toBeCloseTo(-360.25);
    await act(async () => button("撤销").click()); expect(rollingPair(current()!)!.angle).toBe(0);
  });
  it("publishes one direct classroom endpoint and preserves it after acknowledgement without replay", async () => {
    const initial = createRollingWorkbenchState(), source = planarSnapshot(initial), submit = vi.fn<(next: PlanarSnapshot) => Promise<void>>().mockResolvedValue(undefined);
    await render({ initial, classroom: { state: source, onChange: submit } }); await rollGesture(initial, [60, 120, 180, 240, 300, 360, 420]);
    expect(submit).toHaveBeenCalledTimes(1); const endpoint = submit.mock.calls[0][0]; expect(endpoint.motion).toBeNull(); expect(endpoint.past).toHaveLength(1);
    await render({ initial, classroom: { state: endpoint, onChange: submit } }); expect(rollingPair(current()!)!.angle).toBeCloseTo(420, 8); expect(submit).toHaveBeenCalledTimes(1);
    await render({ initial: endpoint.current, readOnly: true, locale: "en" }); const before = current(); await rollGesture(endpoint.current, [480, 540]); expect(current()).toEqual(before); expect(body().getAttribute("aria-disabled")).toBe("true");
  });
});
