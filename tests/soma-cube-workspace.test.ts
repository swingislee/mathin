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

const canvas = vi.hoisted(() => ({ props: null as SomaCanvasProps | null }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SomaCanvasProps) { canvas.props = props; return null; } }));
let root: Root, container: HTMLDivElement;
const m = somaMessages("en");
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
});
