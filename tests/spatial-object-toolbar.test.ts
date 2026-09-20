// @vitest-environment jsdom
import { act, createElement, forwardRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Object3D, OrthographicCamera } from "three";
import type { Html } from "@react-three/drei";
import { SpatialObjectToolbar } from "@/features/tools/spatial-interaction/SpatialObjectToolbar";
import { unitCubeCorners } from "@/features/tools/spatial-interaction/rolling";

const host = vi.hoisted(() => ({ invalidate: vi.fn(), position: null as ComponentProps<typeof Html>["calculatePosition"] | null }));
vi.mock("@react-three/fiber", () => ({ useThree: (select: (state: { invalidate: () => void }) => unknown) => select(host) }));
vi.mock("@react-three/drei", () => ({ Html: forwardRef<HTMLDivElement, ComponentProps<typeof Html>>(function HtmlStub(props, ref) {
  host.position = props.calculatePosition;
  return createElement("div", { ref, style: props.style, "data-test-toolbar": true }, props.children);
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("measures the actual HTML, updates after expansion, hides when no space remains and releases its observer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let width = 54, resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(54);
  const container = document.createElement("div"), root = createRoot(container);
  const center = { x: 0, y: 0, z: 0 }, camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  try {
    // eslint-disable-next-line react/no-children-prop
    await act(async () => root.render(createElement(SpatialObjectToolbar, { center, vertices: unitCubeCorners([center]), children: createElement("button", null, "Rotate") })));
    const toolbar = container.querySelector<HTMLElement>("[data-test-toolbar]")!;
    const frame = () => host.position!(new Object3D(), camera, { width: 800, height: 600 });
    expect(frame().every(Number.isFinite)).toBe(true); expect(toolbar.style.visibility).toBe("visible");
    width = 224; resize(); expect(frame().every(Number.isFinite)).toBe(true); expect(toolbar.style.visibility).toBe("visible");
    width = 900; resize(); expect(frame()).toEqual([-10000, -10000]); expect(toolbar.style.visibility).toBe("hidden");
    width = 54; resize(); frame(); expect(toolbar.style.visibility).toBe("visible");
    expect(host.invalidate).toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
  expect(disconnect).toHaveBeenCalledTimes(1);
});
