// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { ProjectionWorkspace } from "@/features/tools/projection/ProjectionWorkspace";
import { projectionSnapshot, type ProjectionSnapshot } from "@/features/tools/projection/projection-contract";
import type { CubeStructuresViewport } from "@/features/tools/spatial-lab/CubeStructuresViewport";
import { projectionTool } from "./fixtures/projection-tool";

type ViewportProps = ComponentProps<typeof CubeStructuresViewport>;
const viewport = vi.hoisted(() => ({ props: null as ViewportProps | null }));
vi.mock("@/features/tools/projection/ProjectionScene", () => ({ ProjectionScene: () => null }));
vi.mock("next/dynamic", () => ({ default: () => function ViewportStub(props: ViewportProps) {
  viewport.props = props;
  return createElement("button", { "data-projection-hit": true, onClick: () => props.scene.onGroundClick({ x: 3, y: 0, z: 0 }) }, "Synthetic ground hit");
} }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 局域网环境不要求原生 randomUUID。
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(element: ReactElement) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(StrictMode, null, createElement(NextIntlClientProvider, { locale: "en", timeZone: "UTC", messages: en, children: element }))));
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull(); await act(async () => button!.click());
}
async function textButton(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
describe("projection reuses the cube workbench and common snapshot writer", () => {
  it("captures stable starts, opens settings from the right toolbar and resets the complete scene", async () => {
    const initial = projectionTool().payload.initial, capture = vi.fn();
    await render(createElement(ProjectionWorkspace, { initial, onSnapshot: capture }));
    expect(capture.mock.lastCall![0]).toEqual(initial);
    const settings = `[aria-label="${en.tools.projection.settings}"]`;
    expect(host.querySelector(settings)?.closest("[data-cube-tools-toolbar]")).not.toBeNull();
    await click(settings);
    expect(host.querySelector("[data-cube-canvas-panel]")).not.toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await textButton(en.tools.projection.front);
    await textButton(en.tools.projection.guides);
    expect(capture.mock.lastCall![0]).toMatchObject({ views: ["right", "top"], guides: true });
    await click('[data-cube-tool="build"]');
    expect(host.querySelector("[data-cube-canvas-panel]")).toBeNull();
    await click("[data-projection-hit]");
    expect(capture.mock.lastCall![0].structure.cubes).toHaveLength(initial.structure.cubes.length + 1);
    await click(`[aria-label="${en.teacherMicrocourses.cubeToolbarReset}"]`);
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].at(-1)!;
    expect(confirm).toBeDefined(); await act(async () => confirm.click());
    expect(capture.mock.lastCall![0]).toEqual(initial);
    expect(initial.views).toEqual(["front", "right", "top"]);
  });

  it("waits for durable acceptance and does not send or remount again on its own classroom echo", async () => {
    const initial = projectionTool().payload.initial, origin = projectionSnapshot(initial);
    let accept!: () => void;
    const pending = new Promise<void>((resolve) => { accept = resolve; });
    const sent: ProjectionSnapshot[] = [];
    function Harness() {
      const [state, setState] = useState(origin);
      return createElement(ProjectionWorkspace, { initial, classroom: { state, onChange: async (next) => { sent.push(next); await pending; setState(next); } } });
    }
    await render(createElement(Harness));
    const sceneKey = viewport.props!.sceneKey;
    await click('[data-cube-tool="build"]');
    await click("[data-projection-hit]");
    expect(sent).toHaveLength(1);
    expect(viewport.props!.scene.state.cubes).toHaveLength(6);
    await click("[data-projection-hit]"); expect(sent).toHaveLength(1);
    await act(async () => accept());
    expect(viewport.props!.scene.state.cubes).toHaveLength(7);
    expect(viewport.props!.sceneKey).toBe(sceneKey);
    expect(sent).toHaveLength(1);
    expect(initial.structure.cubes).toHaveLength(6);
  });

  it("restores late-joining read-only viewers without accessing drafts and keeps projection options", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const initial = projectionTool().payload.initial;
    const state = { ...projectionSnapshot(initial), views: ["right" as const], guides: true };
    await render(createElement(ProjectionWorkspace, { initial, classroom: { state } }));
    expect(host.querySelector("[data-cube-structures-workbench]")?.hasAttribute("inert")).toBe(true);
    expect(viewport.props!.readOnly).toBe(true);
    const overlay = viewport.props!.renderSceneOverlay!(viewport.props!.scene.state) as ReactElement<{ views: string[]; guides: boolean }>;
    expect(overlay.props).toMatchObject({ views: ["right"], guides: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the confirmed scene and reports a failed classroom write", async () => {
    const initial = projectionTool().payload.initial;
    await render(createElement(ProjectionWorkspace, { initial, classroom: { state: projectionSnapshot(initial), onChange: async () => { throw new Error("offline"); } } }));
    await click('[data-cube-tool="build"]'); await click("[data-projection-hit]");
    expect(viewport.props!.scene.state.cubes).toHaveLength(6);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(en.teacherMicrocourses.spatialClassroomSyncError);
  });
});
