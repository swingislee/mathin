// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidGeometryWorkspace } from "@/features/tools/solid-geometry/SolidGeometryWorkspace";
import type { SolidGeometryCanvasProps } from "@/features/tools/solid-geometry/SolidGeometryCanvas";
import { createSolidEntity, createSolidGeometryInitial, solidGeometrySnapshot, type SolidGeometrySnapshot } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { solidGeometryMessages } from "@/features/tools/solid-geometry/solid-geometry-messages";
import { solidSectionsMessages } from "@/features/tools/solid-sections/solid-sections-messages";

const canvas = vi.hoisted(() => ({ props: null as SolidGeometryCanvasProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/dynamic", () => ({ default: () => function CanvasStub(props: SolidGeometryCanvasProps) { canvas.props = props; return null; } }));
let container: HTMLDivElement, root: Root, now: number, frames: Map<number, FrameRequestCallback>, nextFrame: number;
const m = solidSectionsMessages("en"), base = solidGeometryMessages("en");
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); now = 1000; frames = new Map(); nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(element: ReactElement) { await act(async () => root.render(createElement(StrictMode, null, element))); }
async function click(label: string) { const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
async function advance(ms = 400) { now += ms; const pending = [...frames.values()]; frames.clear(); await act(async () => { for (const frame of pending) frame(now); }); }

describe("cross-section in the shared teaching space", () => {
  it("opens from the right toolbar without a modal and captures only a settled section", async () => {
    const capture = vi.fn(); await render(createElement(SolidGeometryWorkspace, { onSnapshot: capture }));
    const originCamera = canvas.props!.cameraRevision;
    expect(container.querySelector(`button[aria-label="${m.title}"]`)?.closest("[data-solid-tools-toolbar]")).not.toBeNull();
    await click(m.title); expect(container.querySelector("[data-solid-section-controls]")).not.toBeNull(); expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(capture.mock.lastCall![0]).toBeNull(); await advance();
    expect(capture.mock.lastCall![0].section.enabled).toBe(true);
    await click(m.diagonal); await advance(100); expect(canvas.props!.section!.normal.x).toBeGreaterThan(0); expect(canvas.props!.section!.normal.x).toBeLessThan(1 / Math.sqrt(3));
    await advance(); expect(container.querySelector("[data-solid-section-preview]")).toBeNull();
    expect(canvas.props!.sectionEditable).toBe(true);
    await click(base.close); expect(container.querySelector("[data-solid-section-controls]")).toBeNull();
    expect(canvas.props!.sectionEditable).toBe(true); expect(canvas.props!.section!.sectionOpacity).toBeGreaterThan(0);
    expect(canvas.props!.cameraRevision).toBe(originCamera);
  });
  it("fades only the removed half and restores the complete prepared scene", async () => {
    const initial = createSolidGeometryInitial(), capture = vi.fn(); await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture }));
    await click(m.title); await advance(); await click(m.removePositive); await advance(120);
    expect(canvas.props!.section!.positiveOpacity).toBeGreaterThan(0); expect(canvas.props!.section!.positiveOpacity).toBeLessThan(1); expect(canvas.props!.section!.negativeOpacity).toBe(1);
    expect(canvas.props!.state.entities[0].opacity).toBe(1); expect(capture.mock.lastCall![0]).toBeNull();
    await advance(); expect(capture.mock.lastCall![0].section.removedSide).toBe("positive");
    expect(container.querySelector('input[type="number"]')).toBeNull(); await click(m.precise);
    await click(`${m.increase} ${m.offset}`); await advance(); expect(capture.mock.lastCall![0].section.offset).toBe(0.1);
    await click(base.reset); await advance(); expect(capture.mock.lastCall![0]).toEqual(initial); expect(canvas.props!.section!.positiveOpacity).toBe(1);
  });
  it("explains the curved-solid boundary and keeps extension slots intact", async () => {
    const initial = createSolidGeometryInitial(); initial.entities = [createSolidEntity("sphere", "solid-origin")];
    const renderScene = vi.fn(() => null), renderToolbar = vi.fn(() => createElement("button", { "aria-label": "Measurement extension" }, "Measurement"));
    await render(createElement(SolidGeometryWorkspace, { initial, renderScene, renderToolbar })); await click(m.title);
    expect(container.textContent).toContain(m.unsupported); expect(canvas.props!.state.section.enabled).toBe(false);
    const context = { entities: canvas.props!.entities, selected: canvas.props!.entities[0] };
    canvas.props!.renderScene!(context); expect(renderScene).toHaveBeenCalledWith(context);
    expect(container.querySelector('[aria-label="Measurement extension"]')?.closest("[data-solid-tools-toolbar]")).not.toBeNull();
  });
  it("waits for the common classroom writer and animates on a remote snapshot without intermediate events", async () => {
    const initial = createSolidGeometryInitial(); initial.section.enabled = true;
    const origin = solidGeometrySnapshot(initial), sent: SolidGeometrySnapshot[] = []; let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Harness() { const [state, setState] = useState(origin); return createElement(SolidGeometryWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness)); await click(m.title); await click(m.removeNegative);
    expect(sent).toHaveLength(1); expect(canvas.props!.state.section.removedSide).toBe("none"); expect(canvas.props!.readOnly).toBe(true);
    await act(async () => accept()); await advance(100); expect(canvas.props!.section!.negativeOpacity).toBeGreaterThan(0); expect(canvas.props!.section!.negativeOpacity).toBeLessThan(1);
    await advance(); expect(canvas.props!.section!.negativeOpacity).toBe(0); expect(sent).toHaveLength(1);
    await render(createElement(SolidGeometryWorkspace, { key: "viewer", initial, classroom: { state: sent[0] } }));
    expect(canvas.props!.section!.negativeOpacity).toBe(0); expect(canvas.props!.state.section.removedSide).toBe("negative"); expect(canvas.props!.readOnly).toBe(true);
  });
  it("previews on the solid, commits once on release and does not replay the movement", async () => {
    const capture = vi.fn(); await render(createElement(SolidGeometryWorkspace, { onSnapshot: capture }));
    await click(m.title); await advance();
    const camera = canvas.props!.cameraRevision, next = { ...canvas.props!.state.section, offset: 0.43, tiltA: 17 };
    await act(async () => { canvas.props!.onSectionDragging!(true); canvas.props!.onSectionPreview!(next); });
    expect(canvas.props!.state.section.offset).toBe(0); expect(canvas.props!.section!.offset).toBe(0.43); expect(capture.mock.lastCall![0]).toBeNull();
    await act(async () => { canvas.props!.onSectionPreview!(null); canvas.props!.onSectionDragging!(false); canvas.props!.onSectionCommit!(next); });
    expect(canvas.props!.state.section.offset).toBe(0.43); expect(canvas.props!.section!.offset).toBe(0.43);
    await advance(80); expect(canvas.props!.section!.offset).toBe(0.43); expect(capture.mock.lastCall![0].section).toEqual(next);
    expect(canvas.props!.cameraRevision).toBe(camera);
    await click(base.orbit); expect(canvas.props!.sectionEditable).toBe(false); expect(canvas.props!.section!.sectionOpacity).toBeGreaterThan(0);
  });
  it("keeps the dragged endpoint while waiting for classroom acknowledgement", async () => {
    const initial = createSolidGeometryInitial(); initial.section.enabled = true;
    const origin = solidGeometrySnapshot(initial), sent: SolidGeometrySnapshot[] = []; let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    function Harness() { const [state, setState] = useState(origin); return createElement(SolidGeometryWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } }); }
    await render(createElement(Harness)); await click(m.title); await advance();
    const next = { ...origin.section, offset: -0.35 };
    await act(async () => { canvas.props!.onSectionDragging!(true); canvas.props!.onSectionPreview!(next); });
    expect(sent).toHaveLength(0);
    await act(async () => { canvas.props!.onSectionPreview!(null); canvas.props!.onSectionDragging!(false); canvas.props!.onSectionCommit!(next); });
    expect(sent).toHaveLength(1); expect(canvas.props!.state.section.offset).toBe(0); expect(canvas.props!.section!.offset).toBe(-0.35);
    await advance(100); expect(canvas.props!.section!.offset).toBe(-0.35);
    await act(async () => accept()); expect(canvas.props!.section!.offset).toBe(-0.35);
    await advance(100); expect(canvas.props!.section!.offset).toBe(-0.35); expect(sent).toHaveLength(1);
  });
  it("returns from a cancelled or failed preview without writing an unconfirmed scene", async () => {
    const initial = createSolidGeometryInitial(); initial.section.enabled = true;
    const capture = vi.fn(), origin = solidGeometrySnapshot(initial), sent = vi.fn(async () => { throw new Error("not saved"); });
    await render(createElement(SolidGeometryWorkspace, { initial, onSnapshot: capture, classroom: { state: origin, onChange: sent } }));
    await click(m.title); await advance(); const next = { ...origin.section, offset: 0.6 };
    await act(async () => { canvas.props!.onSectionDragging!(true); canvas.props!.onSectionPreview!(next); });
    await act(async () => { canvas.props!.onSectionPreview!(null); canvas.props!.onSectionDragging!(false); });
    expect(sent).not.toHaveBeenCalled(); await advance(); expect(canvas.props!.section!.offset).toBe(0);
    await act(async () => { canvas.props!.onSectionPreview!(next); });
    await act(async () => { canvas.props!.onSectionPreview!(null); canvas.props!.onSectionCommit!(next); });
    expect(sent).toHaveBeenCalledTimes(1); expect(canvas.props!.state.section.offset).toBe(0);
    await advance(); expect(canvas.props!.section!.offset).toBe(0); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(capture.mock.lastCall![0].section.offset).toBe(0);
  });
});
