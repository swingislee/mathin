// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CurvedNetsWorkspace } from "@/features/tools/solid-nets/CurvedNetsWorkspace";
import { SolidNetsCompleteWorkspace } from "@/features/tools/solid-nets/SolidNetsCompleteWorkspace";
import type { CurvedNetsViewport } from "@/features/tools/solid-nets/CurvedNetsViewport";
import { createCurvedNet } from "@/features/tools/solid-nets/curved-contract";

type Props = ComponentProps<typeof CurvedNetsWorkspace>;
const viewport = vi.hoisted(() => ({ current: null as ComponentProps<typeof CurvedNetsViewport> | null }));
vi.mock("next/dynamic", () => ({ default: () => function ViewportStub(props: ComponentProps<typeof CurvedNetsViewport>) { viewport.current = props; return null; } }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
let root: Root, host: HTMLDivElement, clock = 1000000, serial = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); frames.clear(); clock = 1000000;
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(extra: Partial<Props> = {}) { await act(async () => root.render(createElement(CurvedNetsWorkspace, { locale: "en", initial: createCurvedNet(), ...extra }))); }
function button(label: string) { const b = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label); expect(b, label).toBeDefined(); return b!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function tick(time: number) { clock = 1000000 + time; const next = [...frames.values()]; frames.clear(); await act(async () => next.forEach((f) => f(time))); }

describe("curved paper teacher interactions", () => {
  it("shows sequential roll and cap frames, can pause, then resumes to closure", async () => {
    const capture = vi.fn(); await render({ onSnapshot: capture });
    await click("Fold into a solid"); await tick(0); await tick(625);
    expect(viewport.current!.snapshot.progress).toEqual({ side: 0.5, lower: 0, upper: 0 });
    expect(viewport.current!.cameraInteractive).toBe(true); expect(viewport.current!.interactive).toBe(false);
    expect(capture.mock.lastCall![0]).toBeNull(); expect(button("Pause").disabled).toBe(false);
    await click("Pause"); expect(viewport.current!.snapshot.progress.side).toBeCloseTo(0.5); expect(capture.mock.lastCall![0].motion).toBeNull();
    await click("Fold into a solid"); await tick(625); await tick(5000);
    expect(viewport.current!.snapshot.progress).toEqual({ side: 1, lower: 1, upper: 1 }); expect(capture.mock.lastCall![0].motion).toBeNull();
    await click("Unfold in sequence"); await tick(5000); await tick(5625);
    expect(viewport.current!.snapshot.progress).toEqual({ side: 1, lower: 1, upper: 0.5 });
    await tick(9000); expect(viewport.current!.snapshot.progress).toEqual({ side: 0, lower: 0, upper: 0 });
  });
  it("holds a direct drag endpoint through classroom acknowledgement and clears selection on a blank tap", async () => {
    const initial = createCurvedNet(); let resolve!: () => void; const onChange = vi.fn<(next: typeof initial) => Promise<void>>(() => new Promise<void>((done) => { resolve = done; }));
    await render({ runtime: { state: initial, onChange } });
    await act(async () => { viewport.current!.onSelect("side"); viewport.current!.onDragging(true); viewport.current!.onPreview("side", 0.43); });
    expect(viewport.current!.snapshot.progress.side).toBe(0.43);
    await act(async () => { viewport.current!.onCommit("side", 0.43); viewport.current!.onDragging(false); });
    expect(onChange).toHaveBeenCalledTimes(1); expect(viewport.current!.snapshot.progress.side).toBe(0.43);
    const next = onChange.mock.calls[0][0]; await act(async () => resolve()); await render({ runtime: { state: next, onChange } });
    expect(viewport.current!.snapshot.progress.side).toBe(0.43); expect(frames.size).toBe(0);
    await act(async () => viewport.current!.onPointerMissed!(new MouseEvent("click", { button: 0 })));
    expect(viewport.current!.selected).toBeNull(); expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("keeps read-only viewers immutable and fails back to authoritative state", async () => {
    const initial = createCurvedNet(); await render({ runtime: { state: initial }, readOnly: true });
    expect(button("Fold into a solid").disabled).toBe(true); expect(viewport.current!.interactive).toBe(false);
    const onChange = vi.fn(async () => { throw new Error("offline"); }); await render({ runtime: { state: initial, onChange } });
    await act(async () => viewport.current!.onCommit("side", 0.4));
    expect(host.textContent).toContain("Sync failed"); expect(viewport.current!.snapshot.progress.side).toBe(0);
  });
  it("offers six solids inside one floating panel and restores the prepared tool across modes", async () => {
    const capture = vi.fn(); await act(async () => root.render(createElement(SolidNetsCompleteWorkspace, { onSnapshot: capture })));
    await click("Solid & dimensions"); expect(button("Cube").getAttribute("aria-pressed")).toBe("true");
    await click("Cylinder"); await click("Solid and dimensions");
    expect(host.querySelector('[data-cube-canvas-panel]')).not.toBeNull(); expect(button("Cone")).toBeDefined();
    await click("Cone"); expect(capture.mock.lastCall![0]).toMatchObject({ mode: "curved", data: { kind: "cone" } });
    await click("Restore starting scene"); expect(capture.mock.lastCall![0]).toMatchObject({ mode: "polyhedron", data: { kind: "cube" } });
  });
  it("works when randomUUID is unavailable on LAN HTTP", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: undefined });
    try { await render(); await click("Fold into a solid"); expect(viewport.current!.snapshot.progress.side).toBe(0); expect(frames.size).toBeGreaterThan(0); }
    finally { if (descriptor) Object.defineProperty(globalThis.crypto, "randomUUID", descriptor); }
  });
});
