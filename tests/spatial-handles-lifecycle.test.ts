// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrthographicCamera } from "three";
import { CubeMoveHandles } from "@/features/tools/spatial-lab/CubeMoveHandles";
import { createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import type { CubeMoveInteraction } from "@/features/tools/spatial-lab/cube-structures-drag-controller";
import type { SpatialObjectInteraction } from "@/features/tools/spatial-interaction/object-gesture-controller";

const renderer = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("@react-three/fiber", () => ({ useThree: () => renderer.state }));
vi.mock("@react-three/drei", () => ({ Html: () => null, Line: () => null }));
vi.mock("@/features/tools/spatial-interaction/SpatialTransformHandles", () => ({ SpatialTransformHandles: () => null }));
afterEach(() => vi.unstubAllGlobals());

describe("shared handles React lifecycle", () => {
  it("clears the optional body interaction before effect cleanup, then allows reselection", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"), canvas = document.createElement("canvas");
    document.body.append(host, canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const root = createRoot(host), camera = new OrthographicCamera();
    renderer.state = { gl: { domElement: canvas }, get: () => ({ camera }) };
    const body: SpatialObjectInteraction = {
      key: {}, enabled: true, plane: "table", selected: null, pick: vi.fn(() => null),
      resolve: vi.fn(), onPreview: vi.fn(), onDragging: vi.fn(), onSelect: vi.fn(), onUnavailable: vi.fn(),
    };
    const interaction: CubeMoveInteraction = {
      state: createCubeHistory([]).initial, ids: [], scopeIds: [], axis: "x", kind: "move", snapToGrid: true,
      onAxisChange: vi.fn(), onSelect: vi.fn(), onCommit: vi.fn(), onUnavailable: vi.fn(),
    };
    const onPreview = vi.fn();
    // 保留真实 hook、ref 更新顺序与两套手势监听；空几何隔离 WebGL 绘制。
    const render = async (bodyGesture?: SpatialObjectInteraction) => act(async () => {
      root.render(createElement(CubeMoveHandles, { interaction: { ...interaction, bodyGesture }, presentation: interaction.state, preview: null, onPreview }));
    });
    const tapBlank = () => canvas.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 }));
    try {
      await render(body);
      tapBlank(); expect(body.pick).toHaveBeenCalledTimes(1);
      await render();
      tapBlank(); expect(body.pick).toHaveBeenCalledTimes(1);
      await render(body);
      tapBlank(); expect(body.pick).toHaveBeenCalledTimes(2);
      await render();
      tapBlank(); expect(body.pick).toHaveBeenCalledTimes(2);
      expect(body.onPreview).not.toHaveBeenCalled();
      expect(body.onDragging).not.toHaveBeenCalled();
      expect(interaction.onCommit).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); host.remove(); canvas.remove(); }
  });
});
