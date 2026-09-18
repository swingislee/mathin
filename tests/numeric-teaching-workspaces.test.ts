// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { FractionLine } from "@/features/tools/fraction-line/FractionLine";
import { MotionLab } from "@/features/tools/motion-lab/MotionLab";
import { NumericTeachingCourseware } from "@/features/tools/courseware/NumericTeachingCourseware";
import { fractionCoursewareSchema, initialFractionScene, initialMotionScene, type MotionScene } from "@/features/tools/scenes/numeric-teaching-content";
import type { CoursewareToolRuntime } from "@/features/tools/courseware/tool-classroom";
import type { RunwayLane } from "@/features/tools/motion-lab/RunwayLane";

const lanes = vi.hoisted(() => new Map<number, Parameters<typeof RunwayLane>[0]>());
vi.mock("@/features/tools/motion-lab/RunwayLane", () => ({ RunwayLane: (props: Parameters<typeof RunwayLane>[0]) => { lanes.set(props.runway.id, props); return null; } }));
vi.mock("@/features/tools/motion-lab/RulerOverlay", () => ({ RulerOverlay: () => null }));
let root: Root, host: HTMLDivElement, nextFrame: FrameRequestCallback | undefined, time: number;
function render(child: ReturnType<typeof createElement>) {
  // eslint-disable-next-line react/no-children-prop
  return act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: child })));
}
function click(label: string) {
  const button = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === label || button.getAttribute("aria-label") === label);
  expect(button, label).toBeTruthy();
  return act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { nextFrame = undefined; });
  time = 1000; vi.spyOn(Date, "now").mockImplementation(() => time);
  lanes.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("original numeric tools with scene capture", () => {
  it("restores fraction rows, preserves the initial prop, and emits one settled drag snapshot", async () => {
    const initial = { ...initialFractionScene(), rows: [{ denominator: 3, count: 4, color: "var(--rose)" as const }], denomText: "3" };
    const captured = vi.fn();
    await render(createElement(FractionLine, { embedded: true, initial, onSnapshot: captured }));
    expect(captured.mock.lastCall![0]).toEqual(initial);
    const body = host.firstElementChild!;
    await act(async () => body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(captured.mock.lastCall![0]).toBeNull();
    await click("Plot next point");
    expect(captured.mock.lastCall![0]).toBeNull();
    await act(async () => window.dispatchEvent(new Event("pointerup")));
    expect(captured.mock.lastCall![0].rows[0].count).toBe(5);
    expect(initial.rows[0].count).toBe(4);
  });
  it("restores three tracks, advances locally without transmitting frames, pauses and resets to prepared positions", async () => {
    const initial: MotionScene = { ...initialMotionScene(), runways: [1, 2, 3].map((id) => ({ ...initialMotionScene().runways[0], id, x: id * 2, speed: id })) };
    const captured = vi.fn();
    await render(createElement(MotionLab, { embedded: true, initial, onSnapshot: captured }));
    expect(lanes.size).toBe(3); expect(captured.mock.lastCall![0]).toEqual(initial);
    await click("Go");
    expect(captured.mock.lastCall![0].playback).toEqual({ phase: "running", elapsedMs: 0, startedAt: 1000 });
    const calls = captured.mock.calls.length;
    time = 2000; await act(async () => nextFrame!(0));
    expect(lanes.get(2)!.runway.x).toBe(6);
    time = 3000; await act(async () => nextFrame!(0));
    expect(lanes.get(3)!.runway.x).toBe(12);
    expect(captured).toHaveBeenCalledTimes(calls);
    await click("Pause"); expect(captured.mock.lastCall![0].playback.elapsedMs).toBe(2000);
    await click("Back to start"); expect(lanes.get(3)!.runway.x).toBe(6);
    expect(captured.mock.lastCall![0].playback.phase).toBe("idle");
    expect(initial.runways[2].x).toBe(6);
  });
  it("requires a stable starting scene for preparation and can adopt the visible positions", async () => {
    const captured = vi.fn();
    await render(createElement(MotionLab, { embedded: true, initial: initialMotionScene(), onSnapshot: captured, preparation: true }));
    await click("Go"); expect(captured.mock.lastCall![0]).toBeNull();
    time = 2000; await act(async () => nextFrame!(0));
    await click("Use current positions as start");
    expect(captured.mock.lastCall![0].runways[0].x).toBe(10);
    expect(captured.mock.lastCall![0].playback).toEqual({ phase: "idle", elapsedMs: 0, startedAt: 0 });
  });
  it("uses the shared classroom host for durable changes, own echoes, late join and reset", async () => {
    const tool = fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fractions", initial: initialFractionScene() } });
    const writer = vi.fn<NonNullable<CoursewareToolRuntime["onChange"]>>().mockResolvedValue(undefined);
    let classroom: CoursewareToolRuntime = { onChange: writer };
    const show = () => render(createElement(NumericTeachingCourseware, { tool, classroom }));
    await show(); expect(writer).not.toHaveBeenCalled();
    await click("Plot next point"); expect(writer).toHaveBeenCalledTimes(1);
    const update = writer.mock.calls[0][0];
    classroom = { onChange: writer, state: update }; await show();
    expect(writer).toHaveBeenCalledTimes(1);
    await click(en.teacherMicrocourses.cubeToolbarReset);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.lastCall![0].state).toMatchObject({ snapshot: initialFractionScene() });
    classroom = { state: update }; await show();
    expect(host.querySelector('[inert]')).not.toBeNull();
    expect(tool.payload.initial.rows).toEqual([]);
  });
});
