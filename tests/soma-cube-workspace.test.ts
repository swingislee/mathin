// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { SomaWorkspace } from "@/features/tools/soma-cube/SomaWorkspace";
import type { SomaCanvasProps } from "@/features/tools/soma-cube/SomaCanvas";
import { createSomaInitial, SOMA_CUBE_EXAMPLE } from "@/features/tools/soma-cube/model";
import type { SomaSnapshot } from "@/features/tools/soma-cube/contract";
import { somaMessages } from "@/features/tools/soma-cube/messages";
import { somaGestureLanding } from "@/features/tools/soma-cube/manipulation";
import { somaPose } from "@/features/tools/soma-cube/pieces";

const canvas = vi.hoisted(() => ({ props: null as SomaCanvasProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SomaCanvasProps) { canvas.props = props; return null; } }));
let root: Root, container: HTMLDivElement;
const m = somaMessages("en");
function freeTurn(initial: SomaSnapshot) {
  const piece = initial.pieces[0], pose = somaPose(piece);
  return somaGestureLanding(initial, piece.id, { ...pose, quaternion: [0, Math.sin(0.31), 0, Math.cos(0.31)] }, "rotate", true).snapshot;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("crypto", {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(element: ReactElement) {
  await act(async () => root.render(createElement(StrictMode, null,
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: element }))));
}
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(button).toBeDefined(); expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
}
describe("Soma teaching workspace", () => {
  it("offers local drag-plane trials and keeps movement and rotation axes independent", async () => {
    const initial = createSomaInitial(); await render(createElement(SomaWorkspace, { initial }));
    expect(canvas.props!.movePlane).toBe("table"); expect(canvas.props!.preciseAxes).toBe(false);
    await click(m.move); expect(canvas.props!.preciseAxes).toBe(true);
    await click(m.screenMove); await click(`Z ${m.move}`);
    expect(canvas.props!.movePlane).toBe("screen"); expect(canvas.props!.snapshot).toBe(initial);
    await click(m.rotate); expect(canvas.props!.navigation).toBe("rotate"); expect(canvas.props!.preciseAxes).toBe(false);
    await click(`X ${m.rotate}`); expect(canvas.props!.rotationAxis).toBe("x"); expect(canvas.props!.moveAxis).toBe("z");
    await click(m.close); expect(canvas.props!.navigation).toBe("orbit"); expect(canvas.props!.movePlane).toBe("screen");
  });
  it("commits a free gesture once and preserves its endpoint through a cloned classroom echo", async () => {
    const initial = createSomaInitial(), writes: SomaSnapshot[] = []; let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Teacher() {
      const [state, setState] = useState(initial);
      return createElement(SomaWorkspace, { initial, classroom: { state, onChange: async (next) => { writes.push(next); await pending; setState(structuredClone(next)); } } });
    }
    await render(createElement(Teacher));
    const next = freeTurn(initial);
    await act(async () => { expect(canvas.props!.onPoseCommit!(next)).toBe(true); });
    expect(writes).toEqual([next]); expect(canvas.props!.snapshot).toBe(next); const key = canvas.props!.instantKey;
    await act(async () => accept()); expect(canvas.props!.snapshot).toEqual(next); expect(canvas.props!.instantKey).toBe(key);
    await render(createElement(SomaWorkspace, { key: "viewer", initial, classroom: { state: JSON.parse(JSON.stringify(next)) } }));
    expect(canvas.props!.snapshot).toEqual(next); expect(canvas.props!.readOnly).toBe(true);
  });
  it("captures, undoes and restores arbitrary rotation, with a touch mode toggle", async () => {
    const initial = createSomaInitial(), capture = vi.fn();
    await render(createElement(SomaWorkspace, { initial, onSnapshot: capture }));
    await act(async () => canvas.props!.onToggleRotation!()); expect(canvas.props!.navigation).toBe("rotate");
    const next = freeTurn(initial);
    await act(async () => { canvas.props!.onDragging(true); }); expect(capture.mock.lastCall![0]).toBeNull();
    await act(async () => { canvas.props!.onPoseCommit!(next); canvas.props!.onDragging(false); });
    expect(capture.mock.lastCall![0]).toEqual(next);
    await click(m.undo); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
    await click(m.redo); expect(canvas.props!.snapshot.pieces).toEqual(next.pieces);
    await click(m.reset); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
    await render(createElement(SomaWorkspace, { key: "reopen", initial: JSON.parse(JSON.stringify(next)) }));
    expect(canvas.props!.snapshot.pieces).toEqual(next.pieces);
  });
  it("defaults to release snapping, separates it from view snapping and applies the choice to precise buttons", async () => {
    const initial = createSomaInitial(); await render(createElement(SomaWorkspace, { initial }));
    const cameraSnap = canvas.props!.axisSnap;
    expect(canvas.props!.rotationSnap).toBe(true);
    await click(m.rotate); expect(container.textContent).not.toContain("Align to grid");
    await click(`${m.rotate} Y +90°`); expect(canvas.props!.snapshot.pieces[0].orientation).toBeTypeOf("number");
    await click(m.undo); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
    await click(m.rotationSnap); expect(canvas.props!.rotationSnap).toBe(false);
    expect(canvas.props!.axisSnap).toBe(cameraSnap);
    await click(`${m.rotate} Y +90°`); expect(canvas.props!.snapshot.pieces[0].quaternion).toBeDefined();
    const free = canvas.props!.snapshot;
    await click(m.rotationSnap); expect(canvas.props!.rotationSnap).toBe(true);
    expect(canvas.props!.snapshot).toBe(free); // 开关只影响后续手势，不改写准备好的现场。
  });
  it("publishes only the snapped endpoint and reuses it through the classroom echo, undo and restore", async () => {
    const initial = createSomaInitial(), writes: SomaSnapshot[] = [];
    function Teacher() {
      const [state, setState] = useState(initial);
      return createElement(SomaWorkspace, { initial, classroom: { state, onChange: async (next) => { writes.push(next); setState(structuredClone(next)); } } });
    }
    await render(createElement(Teacher));
    const pose = somaPose(initial.pieces[0]);
    const next = somaGestureLanding(initial, "bao-1", { ...pose, quaternion: [0, Math.sin(Math.PI / 4 - 0.03), 0, Math.cos(Math.PI / 4 - 0.03)] }, "rotate", true, canvas.props!.rotationSnap).snapshot;
    await act(async () => { canvas.props!.onPoseCommit!(next); });
    expect(writes).toEqual([next]); expect(canvas.props!.snapshot).toEqual(next); expect(next.pieces[0].quaternion).toBeUndefined();
    expect(canvas.props!.instantKey).not.toBeNull();
    await render(createElement(SomaWorkspace, { key: "local", initial }));
    await act(async () => { canvas.props!.onPoseCommit!(next); });
    await click(m.undo); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
    await click(m.redo); expect(canvas.props!.snapshot.pieces).toEqual(next.pieces);
    await click(m.reset); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
  });
  it("retains the v1 contract and rejects arbitrary poses from a stale or incorrect adapter", async () => {
    const initial = createSomaInitial();
    await render(createElement(SomaWorkspace, { initial, freeRotation: false }));
    expect(canvas.props!.freeRotation).toBe(false);
    await act(async () => { expect(canvas.props!.onPoseCommit!(freeTurn(initial))).toBe(false); });
    expect(canvas.props!.snapshot).toBe(initial);
    await click(m.rotate); await click(`${m.rotate} Y +90°`);
    expect(canvas.props!.snapshot.pieces[0].orientation).toBeTypeOf("number");
    expect(canvas.props!.snapshot.pieces[0].quaternion).toBeUndefined();
  });
  it("uses the shared rolling action and leaves no hidden operation behind a closed panel", async () => {
    const initial = createSomaInitial(); initial.pieces = [initial.pieces[0]];
    await render(createElement(SomaWorkspace, { initial }));
    await click("Roll along a direction");
    const action = canvas.props!.rollAction!; expect(action.plans["z-"]).toBeDefined();
    await click("Roll along a direction Z-");
    expect(canvas.props!.snapshot.pieces[0].orientation).not.toBe(0);
    await click(m.close); expect(canvas.props!.navigation).toBe("orbit"); expect(canvas.props!.rollAction).toBeUndefined();
    await click(m.rotate); await click(m.rotate); expect(canvas.props!.navigation).toBe("orbit");
  });
  it("chooses any piece count, permits a nonconsecutive subset, and retains one piece", async () => {
    await render(createElement(SomaWorkspace)); await click(m.pieces);
    for (let size = 1; size <= 7; size++) { await click(`${size} ${m.countUnit}`); expect(canvas.props!.snapshot.pieces).toHaveLength(size); }
    await click(`2 ${m.countUnit}`); await click(`${m.remove} 1宝`); await click(`${m.add} 7宝`);
    expect(canvas.props!.snapshot.pieces.map((piece) => piece.id)).toEqual(["bao-2", "bao-7"]);
    await click(`${m.remove} 2宝`);
    expect(container.querySelector<HTMLButtonElement>(`button[aria-label="${m.remove} 7宝"]`)!.disabled).toBe(true);
  });
  it("observes one piece and returns to the original assembly, then manipulates and undoes a whole Bao", async () => {
    const initial = createSomaInitial(), capture = vi.fn();
    await render(createElement(SomaWorkspace, { initial, onSnapshot: capture }));
    await click(`${m.choose} 5宝`); await click(m.observe);
    expect(canvas.props!.snapshot.mode).toBe("observe"); expect(canvas.props!.snapshot.pieces).toBe(initial.pieces);
    await click(m.assemble); expect(canvas.props!.snapshot.pieces).toBe(initial.pieces);
    await click(m.move); await click(`${m.move} Y +1`);
    expect(canvas.props!.snapshot.pieces[4].position.y).toBe(1);
    await click(m.rotate); await click(`${m.rotate} Y +90°`);
    expect(canvas.props!.snapshot.pieces[4].orientation).not.toBe(0);
    await click(m.undo); expect(canvas.props!.snapshot.pieces[4].orientation).toBe(0);
    await click(m.redo); expect(canvas.props!.snapshot.pieces[4].orientation).not.toBe(0);
    await click(m.reset); expect(capture.mock.lastCall![0].pieces).toEqual(initial.pieces);
  });
  it("preserves a drag target and captures only the committed full-piece endpoint", async () => {
    const initial = createSomaInitial(), capture = vi.fn();
    await render(createElement(SomaWorkspace, { initial, onSnapshot: capture }));
    await act(async () => canvas.props!.onSelect("bao-6"));
    expect(canvas.props!.snapshot.pieces).toBe(initial.pieces);
    await act(async () => canvas.props!.onDragging(true)); expect(capture.mock.lastCall![0]).toBeNull();
    await act(async () => { canvas.props!.onMove({ kind: "move", ids: ["bao-6:2"], axis: "y", distance: 2 }); canvas.props!.onDragging(false); });
    expect(capture.mock.lastCall![0].pieces[5].position.y).toBe(2);
    await act(async () => canvas.props!.onMove({ kind: "move", ids: ["bao-6:2"], axis: "y", distance: -3 }));
    expect(capture.mock.lastCall![0].pieces[5].position.y).toBe(2); expect(container.textContent).toContain(m.blocked);
  });
  it("opens the cube example and restores the prepared starting scene", async () => {
    const initial = createSomaInitial();
    await render(createElement(SomaWorkspace, { initial })); await click(m.pieces); await click(m.example);
    expect(canvas.props!.snapshot.pieces).toEqual(SOMA_CUBE_EXAMPLE);
    await click(m.apart); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
    await click(m.reset); expect(canvas.props!.snapshot.pieces).toEqual(initial.pieces);
  });
  it("waits for the classroom writer and restores late viewers as read-only", async () => {
    const initial = createSomaInitial(), writes: SomaSnapshot[] = []; let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Teacher() {
      const [state, setState] = useState(initial);
      return createElement(SomaWorkspace, { initial, classroom: { state, onChange: async (next) => { writes.push(next); await pending; setState(next); } } });
    }
    await render(createElement(Teacher)); await click(m.move); await click(`${m.move} Y +1`);
    expect(writes).toHaveLength(1); expect(canvas.props!.snapshot.pieces[0].position.y).toBe(0); expect(canvas.props!.readOnly).toBe(true);
    await act(async () => accept()); expect(canvas.props!.snapshot.pieces[0].position.y).toBe(1); expect(canvas.props!.readOnly).toBe(false);
    await render(createElement(SomaWorkspace, { initial, classroom: { state: writes[0] } }));
    expect(canvas.props!.snapshot.pieces[0].position.y).toBe(1); expect(canvas.props!.readOnly).toBe(true);
    await act(async () => canvas.props!.onMove({ kind: "move", ids: ["bao-1:0"], axis: "y", distance: 1 }));
    expect(canvas.props!.snapshot).toBe(writes[0]);
  });
  it("preserves the prior classroom state after a rejected write", async () => {
    const initial = createSomaInitial(), onChange = vi.fn().mockRejectedValue(new Error("offline"));
    await render(createElement(SomaWorkspace, { initial, classroom: { state: initial, onChange } }));
    await click(m.move); await click(`${m.move} Y +1`);
    expect(onChange).toHaveBeenCalledTimes(1); expect(canvas.props!.snapshot).toBe(initial); expect(container.textContent).toContain(m.syncError);
  });
  it("holds an already dragged endpoint during classroom persistence and does not replay its echo", async () => {
    const initial = createSomaInitial(), writes: SomaSnapshot[] = []; let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Teacher() {
      const [state, setState] = useState(initial);
      return createElement(SomaWorkspace, { initial, classroom: { state, onChange: async (next) => { writes.push(next); await pending; setState(structuredClone(next)); } } });
    }
    await render(createElement(Teacher));
    await act(async () => canvas.props!.onMove({ kind: "move", ids: ["bao-2:0"], axis: "y", distance: 1 }));
    expect(writes).toHaveLength(1); expect(canvas.props!.snapshot.selectedId).toBe("bao-2");
    expect(canvas.props!.snapshot.pieces[1].position.y).toBe(1); expect(canvas.props!.readOnly).toBe(true);
    const instant = canvas.props!.instantKey;
    await act(async () => accept());
    expect(canvas.props!.snapshot.pieces[1].position.y).toBe(1); expect(canvas.props!.instantKey).toBe(instant);
  });
  it("a failed direct classroom move returns to the confirmed pose", async () => {
    const initial = createSomaInitial(), onChange = vi.fn().mockRejectedValue(new Error("offline"));
    await render(createElement(SomaWorkspace, { initial, classroom: { state: initial, onChange } }));
    await act(async () => canvas.props!.onMove({ kind: "move", ids: ["bao-1:0"], axis: "y", distance: 1 }));
    expect(onChange).toHaveBeenCalledTimes(1); expect(canvas.props!.snapshot).toBe(initial);
    expect(container.textContent).toContain(m.syncError);
  });
  it("a failed free rotation returns to the confirmed classroom pose", async () => {
    const initial = createSomaInitial(), onChange = vi.fn().mockRejectedValue(new Error("offline"));
    await render(createElement(SomaWorkspace, { initial, classroom: { state: initial, onChange } }));
    await act(async () => { canvas.props!.onPoseCommit!(freeTurn(initial)); });
    expect(onChange).toHaveBeenCalledTimes(1); expect(canvas.props!.snapshot).toBe(initial); expect(container.textContent).toContain(m.syncError);
  });
});
