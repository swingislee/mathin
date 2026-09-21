// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpatialToolState } from "@/features/tools/spatial-interaction/useSpatialToolState";
import { spatialTransformMode } from "@/features/tools/spatial-interaction/tool-state";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Workspace() {
    const c = useSpatialToolState({ defaultTool: "orbit", panels: { move: "move", rotate: "orbit", measure: "orbit", color: "color" }, transformPanels: { move: "move", rotate: "rotate" } });
    return createElement("section", { ...c.bindings, "data-selected": String(c.selectionActive) },
      createElement("canvas", { onClick: (event) => c.onPointerMissed(event.nativeEvent) }),
      createElement("button", { onClick: c.activateSelection }, "Select"),
      ...(["move", "rotate", "measure", "color"] as const).map((panel) => createElement("button", { key: panel, onClick: () => c.togglePanel(panel) }, panel)),
      createElement("button", { onClick: c.closePanel }, "Close"), createElement("input"));
  }
  await act(async () => root.render(createElement(Workspace)));
  cleanups.push(async () => { await act(async () => root.unmount()); host.remove(); });
  const section = host.querySelector("section")!;
  const click = async (label: string) => act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
  return { host, section, click, mode: () => section.dataset.spatialTransform, selected: () => section.dataset.selected === "true" };
}

describe("transform handles require an explicit operation, not selection", () => {
  it("keeps existing and future panels opt-in, including a panel merely named move", () => {
    const definition = { defaultTool: "orbit", panels: { move: "move", measurement: "orbit", future: "orbit" } };
    for (const panel of [null, "move", "measurement", "future"] as const) expect(spatialTransformMode({ tool: "move", panel }, definition)).toBeNull();
  });
  it("selecting and teaching panels stay clear; repeat, Close, Escape and blank tap hide handles locally", async () => {
    const a = await setup(), b = await setup();
    expect(a.mode()).toBe("none"); await a.click("Select"); expect(a.mode()).toBe("none");
    await a.click("move"); expect(a.mode()).toBe("move"); expect(b.mode()).toBe("none");
    await a.click("move"); expect(a.mode()).toBe("none"); expect(a.selected()).toBe(true);
    await a.click("rotate"); expect(a.mode()).toBe("rotate");
    await a.click("measure"); expect(a.mode()).toBe("none");
    await a.click("move"); await a.click("color"); expect(a.mode()).toBe("none");
    await a.click("rotate"); await a.click("Close"); expect(a.mode()).toBe("none");
    await a.click("move");
    await act(async () => a.host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.mode()).toBe("move");
    await act(async () => a.section.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.mode()).toBe("none"); expect(a.selected()).toBe(false);
    await a.click("rotate"); expect(a.mode()).toBe("rotate"); expect(a.selected()).toBe(true);
    await act(async () => a.host.querySelector("canvas")!.click());
    expect(a.mode()).toBe("none"); expect(a.selected()).toBe(false); expect(b.selected()).toBe(true);
    await a.click("Select"); expect(a.mode()).toBe("none"); expect(a.selected()).toBe(true);
  });
});
