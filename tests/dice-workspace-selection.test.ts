// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiceTeachingWorkspace from "@/features/tools/spatial-lab/DiceTeachingWorkspace";
import type DiceTeachingCanvas from "@/features/tools/spatial-lab/DiceTeachingCanvas";
import { createDiceScene } from "@/features/tools/spatial-lab/dice-teaching-model";

type Props = ComponentProps<typeof DiceTeachingCanvas>;
const canvas = vi.hoisted(() => ({ props: null as Props | null }));
vi.mock("next/dynamic", () => ({ default: () => function Stub(props: Props) { canvas.props = props; return null; } }));
afterEach(() => vi.unstubAllGlobals());
describe("dice selection lifecycle", () => {
  it("deselects and reselects dice without returning moved faces or changing the scene", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const scene = createDiceScene(); scene.dice[0].offsets = { "y-": 0.9 };
    const initial = { scene, selectedId: scene.dice[0].id, arrows: true, grid: true, axes: false, floor: true, view: "angle" as const, frame: { center: { x: 0, y: 0, z: 0 }, radius: 4 } };
    const capture = vi.fn();
    try {
      await act(async () => root.render(createElement(DiceTeachingWorkspace, { locale: "en", initial, onSnapshot: capture })));
      await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
      expect(canvas.props!.selectionActive).toBe(false); expect(canvas.props!.dice).toBe(scene.dice);
      expect(capture.mock.lastCall![0].scene).toBe(scene);
      await act(async () => canvas.props!.onSelect(scene.dice[1].id));
      expect(canvas.props!.selectionActive).toBe(true); expect(canvas.props!.selectedId).toBe(scene.dice[1].id);
      expect(canvas.props!.dice[0].offsets).toEqual({ "y-": 0.9 });
      await act(async () => canvas.props!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
      const moved = { ...scene.dice[0], position: { x: -1.23, y: 0.5, z: 0.37 } };
      await act(async () => { expect(canvas.props!.onTransform!(moved)).toBe(true); });
      expect(canvas.props!.selectionActive).toBe(true); expect(canvas.props!.selectedId).toBe(moved.id);
      expect(canvas.props!.dice[0]).toEqual(moved); expect(canvas.props!.busy).toBe(false);
      expect(capture.mock.lastCall![0].scene.dice[0]).toEqual(moved);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
