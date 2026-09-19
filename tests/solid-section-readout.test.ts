// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrthographicCamera, type Camera } from "three";
import { SolidSectionReadout } from "@/features/tools/solid-sections/SolidSectionReadout";
import { createSolidEntity } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { intersectSolidSection, solidSectionPlane } from "@/features/tools/solid-sections/solid-sections";

const stage = vi.hoisted(() => ({ size: { width: 800, height: 600 }, frame: null as null | ((state: { camera: Camera; size: { width: number; height: number } }) => void) }));
vi.mock("@react-three/fiber", () => ({ useThree: () => ({ size: stage.size }), useFrame: (callback: typeof stage.frame) => { stage.frame = callback; } }));
vi.mock("@react-three/drei", () => ({ Html: ({ children, style }: { children: ReactNode; style: object }) => createElement("div", { style, "data-stage-annotation": true }, children) }));
let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it("renders a non-intercepting in-stage diagram whose line follows the true section as the view rotates", async () => {
  const entity = createSolidEntity("cube", "cube", { x: 0, y: 0, z: 0 });
  const plane = solidSectionPlane(entity, { x: 0, y: 1, z: 0 }, 0.4), result = intersectSolidSection(entity, plane);
  await act(async () => root.render(createElement(SolidSectionReadout, { entity, plane, result, locale: "zh", opacity: 0.82 })));
  const camera = new OrthographicCamera(-5, 5, 3.75, -3.75, 0.01, 100);
  camera.position.set(5, 7, 9); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  stage.frame!({ camera, size: stage.size });
  const readout = container.querySelector("[data-solid-section-readout]")!, line = readout.querySelector("line")!;
  expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(readout.querySelector("polygon")).not.toBeNull();
  expect(readout.getAttribute("aria-label")).toContain("平视截口");
  expect(container.querySelector<HTMLElement>("[data-stage-annotation]")!.style.pointerEvents).toBe("none");
  const before = line.getAttribute("y1"); expect(readout.querySelector("g")!.getAttribute("visibility")).toBe("visible");
  camera.position.set(0, 10, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  stage.frame!({ camera, size: stage.size }); expect(line.getAttribute("y1")).not.toBe(before);
  expect(line.getAttribute("x1")).toBe(readout.querySelector("circle")!.getAttribute("cx"));
});
