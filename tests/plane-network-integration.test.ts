// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanarWorkbench } from "@/features/tools/planar-kit/PlanarWorkbench";
import { planarSnapshot, planarSnapshotForTool, type PlanarState } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarHistory } from "@/features/tools/planar-kit/presentation";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { addNetworkPoint, appendNetworkVisit, createNetworkState, liftNetworkPen, networkComponent, networkRecords, recordNetworkFigure, setNetworkField, setNetworkFlag, tapNetworkTarget } from "@/features/tools/plane-network/model";
import { planeNetworkCases } from "./fixtures/plane-network-cases";

vi.mock("next-intl", () => ({ useLocale: () => "zh" }));

describe("unchanged v2 network persistence", () => {
  it("accepts exact-edit endpoints and rejects new cached display fields", () => {
    for (const entry of planeNetworkCases()) {
      if (entry.accepted) expect(() => parseToolScene(entry.scene), entry.label).not.toThrow();
      else expect(() => parseToolScene(entry.scene), entry.label).toThrow();
    }
  });
  it("freezes detached geometry and reuses v2 snapshot/history contracts", () => {
    const initial = tapNetworkTarget(createNetworkState("47-create"), "node.0"), changed = setNetworkField(initial, "nodeX", 280.125);
    const frozen = freezeToolScene(parseToolScene({ toolId: "plane-patterns", contentVersion: "plane-patterns-lesson-v2", payload: { title: "Exact network", initial: changed } }));
    if (frozen.toolId !== "plane-patterns") throw new Error("Unexpected tool identity");
    const snapshot = planarCommit(planarSnapshot(initial), initial, changed);
    expect(planarSnapshotForTool("plane-patterns", "plane-patterns-lesson-v2").safeParse(snapshot).success).toBe(true);
    expect(planarHistory(snapshot, "undo").current).toEqual(initial); expect(planarHistory(planarHistory(snapshot, "undo"), "redo").current).toEqual(changed);
    changed.points["node.0"].x = 500; expect(frozen.payload.initial.points["node.0"].x).toBe(280.125);
  });
});

let container: HTMLDivElement, root: Root;
const capture = vi.fn<(state: PlanarState | null) => void>();
const current = () => capture.mock.calls.at(-1)?.[0];
const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const stage = () => container.querySelector<SVGSVGElement>("svg[viewBox='0 0 960 720']")!;
const node = (id: number) => container.querySelector<SVGGElement>(`g[aria-label="节点 ${id + 1}"]`)!;
const record = (id: number) => container.querySelector<SVGGElement>(`g[data-network-record-label="${id}"]`)!;
const render = async (props: Partial<ComponentProps<typeof PlanarWorkbench>> = {}) => { await act(async () => root.render(createElement(PlanarWorkbench, { toolId: "plane-patterns", locale: "zh", onSnapshot: capture, ...props }))); };
async function pointer(target: Element, type: string, x: number, y: number) {
  await act(async () => target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 })));
}
async function selectNode(id: number) {
  const at = current()!.points[`node.${id}`]; await pointer(node(id), "pointerdown", at.x, at.y); await pointer(stage(), "pointerup", at.x, at.y);
}
async function selectRecord(id: number) { await act(async () => record(id).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))); }

describe("precise network operations in the shared host", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); capture.mockClear();
    vi.stubGlobal("requestAnimationFrame", () => 1); vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    Object.defineProperties(SVGSVGElement.prototype, {
      getScreenCTM: { configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) },
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: () => true }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("edits an unrounded node coordinate, then undoes and redoes exactly once", async () => {
    await render({ initial: setNetworkFlag(setNetworkFlag(createNetworkState("47-create"), "edit", true), "snap", true) });
    await selectNode(0); await act(async () => button("节点的准确舞台坐标").click());
    const initial = current()!, field = container.querySelector<HTMLInputElement>('input[aria-label="节点 X（舞台坐标）"]')!;
    expect(field.getAttribute("step")).toBe("any");
    await act(async () => { field.value = "280.12345"; field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(current()!.points["node.0"].x).toBe(280.12345);
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
    await act(async () => button("重做").click()); expect(current()!.points["node.0"].x).toBe(280.12345);
  });
  it("cancels a live whole-group drag and commits the final gesture as one undoable change", async () => {
    await render({ initial: setNetworkFlag(createNetworkState("47-create"), "edit", true) }); await selectNode(0);
    await act(async () => button("平移或旋转整个连通组").click()); const initial = current()!, center = networkComponent(initial)!.center;
    const handle = () => container.querySelector<SVGGElement>('[aria-label="平移整个连通组"]')!;
    await pointer(handle(), "pointerdown", center.x, center.y); await pointer(stage(), "pointermove", center.x + 40, center.y + 20); expect(current()).toBeNull();
    await pointer(stage(), "pointercancel", center.x + 40, center.y + 20); expect(current()).toEqual(initial);
    await pointer(handle(), "pointerdown", center.x, center.y); await pointer(stage(), "pointermove", center.x + 40, center.y + 20); await pointer(stage(), "pointerup", center.x + 40, center.y + 20);
    expect(current()!.points["node.0"]).toEqual({ x: 320, y: 380 }); expect(current()!.points["node.1"]).toEqual({ x: 640, y: 380 });
    const moved = current()!; await act(async () => button("关闭面板").click()); expect(current()).toEqual(moved); expect(container.querySelector("[data-network-component-handles]")).toBeNull();
    await act(async () => button("撤销").click()); expect(current()).toEqual(initial);
  });
  it("selects and removes exactly one observation, retaining the original lines", async () => {
    let initial = addNetworkPoint(createNetworkState("47-create"), { x: 440, y: 360 });
    initial = recordNetworkFigure(tapNetworkTarget(tapNetworkTarget(initial, "node.0"), "node.1"));
    initial = recordNetworkFigure(tapNetworkTarget(tapNetworkTarget(initial, "node.0"), "node.2"));
    await render({ initial }); await selectRecord(1); const before = current()!;
    await act(async () => button("只移除所选留痕，保留点线").click());
    expect(networkRecords(current()!).map((entry) => entry.id)).toEqual([2]); expect(current()!.points).toEqual(initial.points); expect(record(1)).toBeNull();
    await act(async () => button("撤销").click()); expect(current()).toEqual(before); expect(record(1)).not.toBeNull();
  });
  it("shows each stroke's endpoints and stable ID, removes one and preserves readonly display", async () => {
    let initial = addNetworkPoint(createNetworkState("52-create"), { x: 440, y: 360 });
    initial = appendNetworkVisit(appendNetworkVisit(initial, 0), 2); initial = appendNetworkVisit(appendNetworkVisit(liftNetworkPen(initial), 2), 1);
    await render({ toolId: "plane-graph-path", initial }); expect(container.querySelectorAll("[data-network-stroke-ends]")).toHaveLength(2);
    expect(record(1).getAttribute("aria-label")).toContain("起点 P1，终点 P3"); await selectRecord(1);
    await act(async () => button("只移除所选留痕，保留点线").click()); const remaining = current()!;
    expect(networkRecords(remaining).map((entry) => entry.id)).toEqual([2]); expect(container.querySelectorAll("[data-network-stroke-ends]")).toHaveLength(1);
    await render({ toolId: "plane-graph-path", initial: remaining, readOnly: true, locale: "en" });
    expect(record(2).getAttribute("aria-disabled")).toBe("true"); expect(button("Move or rotate the connected component").disabled).toBe(true); expect(container.querySelector("[data-network-component-handles]")).toBeNull();
  });
});
