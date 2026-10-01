// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SpatialContextActions } from "@/features/tools/spatial-interaction/SpatialContextActions";

afterEach(() => vi.unstubAllGlobals());

it("uses accessible shared actions without passing clicks to the canvas and preserves Escape exit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  const choose = vi.fn(), disabled = vi.fn(), outerClick = vi.fn(), outerPointer = vi.fn(), key = vi.fn();
  try {
    await act(async () => root.render(createElement("div", { onClick: outerClick, onPointerDown: outerPointer, onKeyDown: key }, createElement(SpatialContextActions, {
      label: "Selected box actions", actions: [
        { action: "extractContents", label: "Take out", title: "Take contents out", active: true, onClick: choose },
        { action: "returnContents", label: "Return", disabled: true, onClick: disabled },
      ],
    }))));
    const [take, back] = container.querySelectorAll<HTMLButtonElement>("button");
    expect(container.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Selected box actions");
    expect(take.getAttribute("aria-label")).toBe("Take contents out");
    expect(take.getAttribute("aria-pressed")).toBe("true");
    expect(take.querySelector('[data-spatial-icon="extractContents"]')).not.toBeNull();
    expect(back.disabled).toBe(true);
    await act(async () => { take.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })); take.click(); back.click(); });
    expect(choose).toHaveBeenCalledTimes(1); expect(disabled).not.toHaveBeenCalled();
    expect(outerClick).not.toHaveBeenCalled(); expect(outerPointer).not.toHaveBeenCalled();
    take.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(key).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); }
});
