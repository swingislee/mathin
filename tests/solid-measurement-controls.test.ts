// @vitest-environment jsdom
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSolidEntity, type SolidFeatureSelection } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { createMeasurementSettings, type MeasurementSettings } from "@/features/tools/solid-measurement/measurement-contract";
import { MeasurementButton, MeasurementPanel, type MeasurementPanelProps } from "@/features/tools/solid-measurement/MeasurementControls";
import { measurementMessages } from "@/features/tools/solid-measurement/measurement-messages";

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element: ReactElement) { await act(async () => root.render(element)); }
async function clickText(text: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function clickLabel(label: string) {
  const labelNode = [...container.querySelectorAll("label")].find((item) => item.textContent === label);
  const button = labelNode ? container.querySelector<HTMLButtonElement>(`[id="${labelNode.htmlFor}"]`) : container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull(); await act(async () => button!.click());
}
const m = measurementMessages("en"), cube = createSolidEntity("cube", "solid"), base = { ...createMeasurementSettings(), enabled: true };

describe("controlled measurement canvas panel", () => {
  it("reuses the shared icon button and non-modal panel without another workspace", async () => {
    const open = vi.fn(), close = vi.fn();
    await render(createElement("div", null, createElement(MeasurementButton, { locale: "en", active: true, onClick: open }), createElement(MeasurementPanel, { locale: "en", selected: cube, settings: base, onChange: vi.fn(), onClose: close })));
    await clickLabel(m.title); expect(open).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-cube-canvas-panel]")).not.toBeNull(); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.querySelector("canvas")).toBeNull();
    expect(container.textContent).toContain(m.units); expect(container.textContent).toContain("24 u²"); expect(container.textContent).toContain("8 u³");
    await clickLabel(m.close); expect(close).toHaveBeenCalledTimes(1);
  });
  it("changes one durable target per teacher action and selects existing semantic faces", async () => {
    const changes: MeasurementSettings[] = [], faces: (SolidFeatureSelection | null)[] = [];
    function Harness() {
      const [settings, setSettings] = useState(base), [feature, setFeature] = useState<SolidFeatureSelection | null>(null);
      return createElement(MeasurementPanel, { locale: "en", settings, selected: cube, feature, onClose: () => {}, onChange: (next) => { changes.push(next); setSettings(next); }, onSelectFace: (next) => { faces.push(next); setFeature(next); } });
    }
    await render(createElement(Harness));
    await clickText("Front"); expect(faces).toEqual([{ entityId: "solid", kind: "face", id: "front" }]);
    expect(container.querySelector("[data-measurement-face-area]")?.getAttribute("data-measurement-face-area")).toBe("4");
    await clickLabel(m.unitFill); expect(changes).toHaveLength(1); expect(changes[0].unitFill).toBe(true);
    await clickLabel(m.addLayer); expect(changes).toHaveLength(2); expect(changes[1].fillLayers).toBe(1);
    expect(container.querySelector("[data-measurement-target-count]")?.getAttribute("data-measurement-target-count")).toBe("4");
    await clickText(m.fillAll); expect(changes).toHaveLength(3); expect(changes[2].fillLayers).toBe(2);
    await clickText(m.clear); expect(changes).toHaveLength(4); expect(changes[3].fillLayers).toBe(0);
    expect(base.fillLayers).toBe(0); expect(cube.opacity).toBe(1);
    await clickText("Front"); expect(faces.at(-1)).toBeNull();
  });
  it("discloses unsupported fills while retaining accurate values and fully read-only controls", async () => {
    const change = vi.fn(), box = createSolidEntity("cuboid", "fractional");
    const props: MeasurementPanelProps = { locale: "en", settings: { ...base, unitFill: true }, selected: box, onChange: change, onClose: () => {} };
    await render(createElement(MeasurementPanel, props));
    expect(container.querySelector("[data-unit-fill-boundary]")?.textContent).toBe(m.fillWhole);
    expect(container.querySelector("[data-measurement-layer-controls]")).toBeNull();
    expect(container.textContent).toContain("9 u³");
    await render(createElement(MeasurementPanel, { ...props, selected: cube, disabled: true, onSelectFace: vi.fn() }));
    await clickLabel(m.unitFill); await clickLabel(m.addLayer); await clickText("Front"); expect(change).not.toHaveBeenCalled();
    expect([...container.querySelectorAll<HTMLButtonElement>("[data-solid-measurement-panel] button")].every((button) => button.disabled)).toBe(true);
  });
  it("has complete Chinese and English labels without inventing physical units", async () => {
    const zh = measurementMessages("zh"); expect(Object.keys(zh)).toEqual(Object.keys(m));
    await render(createElement(MeasurementPanel, { locale: "zh", settings: base, selected: createSolidEntity("cylinder", "round"), onChange: () => {}, onClose: () => {} }));
    expect(container.textContent).toContain(zh.title); expect(container.textContent).toContain(zh.cuboidOnly); expect(container.textContent).toContain("≈"); expect(container.textContent).not.toContain("cm");
  });
});
