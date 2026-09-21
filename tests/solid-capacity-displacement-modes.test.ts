// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SolidCapacityTeachingWorkspace } from "@/features/tools/solid-capacity/SolidCapacityTeachingWorkspace";
import type { SolidCapacityWorkspaceProps } from "@/features/tools/solid-capacity/SolidCapacityWorkspace";
import type { DisplacementWorkspaceProps } from "@/features/tools/solid-capacity/DisplacementWorkspace";
import { createDefaultSolidCapacityTeachingInitial, type SolidCapacityTeachingSnapshot } from "@/features/tools/solid-capacity/solid-capacity-teaching-contract";
import { displacementMessages } from "@/features/tools/solid-capacity/displacement-messages";

const children = vi.hoisted(() => ({ pour: null as SolidCapacityWorkspaceProps | null, displacement: null as DisplacementWorkspaceProps | null }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/dynamic", () => ({ default: (loader: () => unknown) => String(loader).includes("DisplacementWorkspace")
  ? function Displacement(props: DisplacementWorkspaceProps) { children.displacement = props; return createElement("div", null, props.workspaceSelector); }
  : function Pour(props: SolidCapacityWorkspaceProps) { children.pour = props; return createElement("div", null, props.workspaceSelector); } }));
let root: Root, container: HTMLDivElement;
const m = displacementMessages("en");
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function switchMode(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${m.modes}"]`)!.click());
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe("one capacity tool, two prepared teaching spaces", () => {
  it("preserves each scene across mode changes and exports one complete v2 initial", async () => {
    const initial = createDefaultSolidCapacityTeachingInitial(), capture = vi.fn();
    await act(async () => root.render(createElement(StrictMode, null, createElement(SolidCapacityTeachingWorkspace, { initial, onSnapshot: capture }))));
    const pour = children.pour!.classroom!.state!;
    await act(async () => children.pour!.classroom!.onChange!({ ...pour, cone: { ...pour.cone, fill: 0 }, cylinder: { ...pour.cylinder, fill: 1 / 3 } }));
    await switchMode(m.displacement);
    const displacement = children.displacement!.classroom!.state!;
    await act(async () => children.displacement!.classroom!.onChange!({ ...displacement, body: { ...displacement.body, bottom: 1.25 } }));
    await switchMode(m.pour); expect(children.pour!.classroom!.state!.cylinder.fill).toBeCloseTo(1 / 3);
    await switchMode(m.displacement); expect(children.displacement!.classroom!.state!.body.bottom).toBe(1.25);
    expect(capture.mock.lastCall![0]).toMatchObject({ mode: "displacement", pour: { cylinder: { fill: 1 / 3 } }, displacement: { body: { bottom: 1.25 } } });
  });
  it("keeps the same input classroom contract and passes child failures back to their writer", async () => {
    const initial = createDefaultSolidCapacityTeachingInitial(); initial.mode = "displacement";
    const publish = vi.fn(async (next: SolidCapacityTeachingSnapshot) => { void next; throw new Error("offline"); });
    await act(async () => root.render(createElement(SolidCapacityTeachingWorkspace, { initial, classroom: { onChange: publish } })));
    const next = children.displacement!.classroom!.state!;
    await expect(children.displacement!.classroom!.onChange!({ ...next, showAmounts: true })).rejects.toThrow("offline");
    expect(publish).toHaveBeenCalledTimes(1); expect(publish.mock.calls[0][0]).toMatchObject({ mode: "displacement", displacement: { showAmounts: true } });
  });
});
