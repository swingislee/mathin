// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpatialAxisSteps } from "@/features/tools/spatial-interaction/SpatialAxisSteps";
import { SpatialViewButtons, SPATIAL_ALL_VIEWS } from "@/features/tools/spatial-interaction/SpatialViewButtons";

afterEach(() => vi.unstubAllGlobals());
describe("shared spatial parameter controls", () => {
  it("routes exact steps and axis choices separately and respects disabled state", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"), root = createRoot(host), step = vi.fn(), axis = vi.fn();
    const props = { label: "Rotate", step: 90, unit: "°", axis: "y" as const, onAxisChange: axis, onStep: step };
    try {
      await act(async () => root.render(createElement(SpatialAxisSteps, props)));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Rotate X −90°"]')!.click());
      expect(step).toHaveBeenCalledExactlyOnceWith("x", -1); expect(axis).not.toHaveBeenCalled();
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Z Rotate"]')!.click());
      expect(axis).toHaveBeenCalledExactlyOnceWith("z"); expect(step).toHaveBeenCalledTimes(1);
      await act(async () => root.render(createElement(SpatialAxisSteps, { ...props, disabled: true })));
      const disabledStep = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label") === "Rotate Y +90°");
      expect(disabledStep).toBeDefined(); expect(disabledStep!.disabled).toBe(true);
      await act(async () => disabledStep!.click());
      expect(step).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });
  it("shares view selection and fit while leaving domain callbacks independent", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div"), root = createRoot(host), change = vi.fn(), fit = vi.fn();
    const labels = { angle: "Angle", front: "Front", left: "Left", right: "Right", top: "Top", bottom: "Bottom" };
    try {
      await act(async () => root.render(createElement(SpatialViewButtons, { views: SPATIAL_ALL_VIEWS, value: "angle", labels, onChange: change, fit: { label: "Fit", onClick: fit } })));
      expect(host.querySelectorAll("[data-spatial-view]")).toHaveLength(6);
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Bottom"]')!.click());
      expect(change).toHaveBeenCalledExactlyOnceWith("bottom"); expect(fit).not.toHaveBeenCalled();
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Fit"]')!.click());
      expect(fit).toHaveBeenCalledTimes(1); expect(change).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
  });
});
