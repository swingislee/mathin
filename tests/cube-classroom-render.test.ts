// @vitest-environment jsdom
import { act, createElement, StrictMode, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { CubeStructuresCourseware } from "@/features/tools/courseware/CubeStructuresCourseware";
import type { CubeStructuresViewport } from "@/features/tools/spatial-lab/CubeStructuresViewport";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { classroomToolInstanceKey, cubeCoursewareOriginHash, createClassroomToolState, cubeCoursewareInitialSession, type CubeClassroomSnapshot } from "@/features/tools/courseware/cube-structures-classroom";
import { createCubeSession, operateCubeSession, startCubeRecording, pauseCubeRecording } from "@/features/tools/spatial-lab/cube-structures-session";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { cubeStructuresMessages } from "@/features/tools/spatial-lab/cube-structures-messages";
import CoursewareCompositionStage from "@/features/courseware-doc/CoursewareCompositionStage";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import type { CoursewareToolRuntime } from "@/features/tools/courseware/tool-classroom";
import { buildNet, diceTool, netTool } from "./fixtures/spatial-teaching-content";

type ViewportProps = ComponentProps<typeof CubeStructuresViewport>;
const viewport = vi.hoisted(() => ({ props: null as ViewportProps | null }));
const renderedTools = vi.hoisted(() => new Map<string, CoursewareToolRuntime | undefined>());
vi.mock("@/features/tools/components", () => ({ CoursewareToolView: ({ tool, classroom }: { tool: { payload: { title: string } }; classroom?: CoursewareToolRuntime }) => {
  renderedTools.set(tool.payload.title, classroom); return null;
} }));
vi.mock("@/features/courseware-doc/DocStage", () => ({ default: () => null }));
vi.mock("@/features/games/courseware/GamePageStage", () => ({ default: () => null }));
vi.mock("@/features/courseware-doc/MicrocourseStage", () => ({ MicrocourseSourceStage: () => null, MicrocourseH5ArtifactFrame: () => null }));
vi.mock("@/features/tools/spatial-lab/CubeStructuresViewport", () => ({ CubeStructuresViewport: () => null }));
vi.mock("next/dynamic", () => ({ default: () => (props: ViewportProps) => {
  viewport.props = props;
  return createElement("button", { "data-cube-hit": true, onClick: () => props.scene.onGroundClick({ x: 1, y: 0, z: 0 }) }, "Synthetic ground hit");
} }));

const base = createCubeSession([{ x: 0, y: 0, z: 0 }]);
const tool = createCubeCoursewareTool({ name: "Classroom Cube", snapshot: cubeDraftSnapshot(base, 0) }, "current", ["build", "view-left", "axes", "undo", "recording"]);
const labels = cubeStructuresMessages("en");
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function mount({ readOnly = false, save = async () => {}, recorded = false } = {} as {
  readOnly?: boolean; save?: (state: CubeClassroomSnapshot) => Promise<void>; recorded?: boolean;
}) {
  let session = base;
  if (recorded) {
    session = startCubeRecording(base);
    session = operateCubeSession(session, { kind: "axes", visible: false });
    session = pauseCubeRecording(session);
  }
  const content = recorded ? createCubeCoursewareTool({ name: "Recording", snapshot: cubeDraftSnapshot(session, 0) }, "recording", ["recording"]) : tool;
  let replace!: (next: CubeClassroomSnapshot) => void;
  const sent: CubeClassroomSnapshot[] = [];
  function Harness() {
    const [state, setState] = useState<CubeClassroomSnapshot>({ session: cubeCoursewareInitialSession(content.payload), view: null, cameraRevision: 0 });
    replace = setState;
    return createElement(CubeStructuresCourseware, { payload: content.payload, classroom: { state,
      onChange: readOnly ? undefined : async (next) => { sent.push(next); await save(next); setState(next); },
    } });
  }
  // Provider 将 children 声明为必填，显式传入以保持 React 19 类型合同。
  // eslint-disable-next-line react/no-children-prop
  const provider = createElement(NextIntlClientProvider, { locale: "en", messages: en, children: createElement(Harness) });
  await act(async () => root.render(createElement(StrictMode, null, provider)));
  return { sent, replace: (next: CubeClassroomSnapshot) => act(async () => replace(next)) };
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull(); await act(async () => button!.click());
}

describe("cube classroom React adapter", () => {
  it("routes both new workbenches through the registered common stage and blocks cross-version writes", async () => {
    const dice = diceTool(), net = netTool(await buildNet());
    const doc = addCoursewareCompositionTool(addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), dice), net);
    const change = vi.fn().mockResolvedValue(undefined);
    const classroomTools = { pageId: "page-new", docId: "doc-new", states: {}, onChange: change };
    await act(async () => root.render(createElement(CoursewareCompositionStage, { doc, interactive: true, bindingUrls: {}, classroomTools })));
    expect(host.querySelectorAll('[data-classroom-tool="synchronized"]')).toHaveLength(2);
    expect(renderedTools.get(dice.payload.title)?.onChange).toBeDefined();
    expect(renderedTools.get(net.payload.title)?.onChange).toBeDefined();
    await expect(renderedTools.get(dice.payload.title)!.onChange!({ toolId: "spatial-lab", contentVersion: "cube-structures-lesson-v2", state: { session: base, view: null, cameraRevision: 0 } })).rejects.toThrow("VERSION_MISMATCH");
    expect(change).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(CoursewareCompositionStage, { doc, interactive: false, bindingUrls: {}, classroomTools })));
    expect(renderedTools.get(dice.payload.title)?.onChange).toBeUndefined(); expect(renderedTools.get(net.payload.title)?.onChange).toBeUndefined();
  });

  it("routes live state by component and source digest, preserving new courseware copies", async () => {
    const second = { ...tool, payload: { ...tool.payload, title: "Second Cube" } };
    const doc = addCoursewareCompositionTool(addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), tool), second);
    const firstId = doc.layout.blocks[0].id, hash = cubeCoursewareOriginHash(tool.payload);
    const snapshot: CubeClassroomSnapshot = { session: operateCubeSession(base, { kind: "axes", visible: false }), view: null, cameraRevision: 0 };
    const payload = createClassroomToolState("page-1", "doc-1", firstId, snapshot, hash);
    const change = vi.fn().mockResolvedValue(undefined);
    const classroomTools = { pageId: "page-1", docId: "doc-1", states: { [classroomToolInstanceKey("doc-1", firstId, hash)]: { payload, sequences: { writer: 1 } } }, onChange: change };
    await act(async () => root.render(createElement(CoursewareCompositionStage, { doc, interactive: true, bindingUrls: {}, classroomTools })));
    expect(renderedTools.get(tool.payload.title)?.state).toEqual(payload);
    expect(renderedTools.get(second.payload.title)?.state).toBeUndefined();
    const update = { toolId: "spatial-lab" as const, contentVersion: "cube-structures-lesson-v2" as const, state: snapshot };
    await renderedTools.get(tool.payload.title)!.onChange!(update);
    expect(change).toHaveBeenCalledWith(firstId, hash, update);
    await act(async () => root.render(createElement(CoursewareCompositionStage, { doc, interactive: true, bindingUrls: {}, classroomTools: { ...classroomTools, pageId: "page-2" } })));
    expect(renderedTools.get(tool.payload.title)?.state).toBeUndefined();
    const updated = { ...doc, layout: { ...doc.layout, blocks: doc.layout.blocks.map((block) => block.id === firstId && block.type === "tool"
      ? { ...block, tool: { ...tool, payload: { ...tool.payload, toolbar: [] } } } : block) } };
    await act(async () => root.render(createElement(CoursewareCompositionStage, { doc: updated, interactive: false, bindingUrls: {}, classroomTools })));
    expect(renderedTools.get(tool.payload.title)?.state).toBeUndefined();
    expect(renderedTools.get(tool.payload.title)?.onChange).toBeUndefined();
  });

  it("publishes once per semantic action under StrictMode and waits for durable acceptance before changing the model", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const rig = await mount({ save: () => pending });
    expect(rig.sent).toHaveLength(0);
    await click("[data-cube-hit]");
    expect(rig.sent).toHaveLength(1);
    expect(viewport.props!.scene.state.cubes).toHaveLength(1);
    expect(host.querySelector('[data-cube-structures-workbench]')?.hasAttribute("inert")).toBe(true);
    await click("[data-cube-hit]");
    expect(rig.sent).toHaveLength(1);
    await act(async () => release());
    expect(viewport.props!.scene.state.cubes).toHaveLength(2);
    expect(viewport.props!.cameraRequestKey).toBe(0);
    await click('button[aria-label="Left"]');
    expect(rig.sent).toHaveLength(2);
    expect(viewport.props!.scene.state.view).toBe("left");
    expect(viewport.props!.cameraRequestKey).toBe(1);
  });

  it("keeps followers read-only and applies every incoming frame without replacing the scene identity", async () => {
    const rig = await mount({ readOnly: true });
    const sceneKey = viewport.props!.sceneKey;
    await click("[data-cube-hit]"); await click('button[aria-label="Left"]');
    expect(rig.sent).toHaveLength(0);
    await rig.replace({ session: operateCubeSession(base, { kind: "axes", visible: false }), view: "top", cameraRevision: 4 });
    expect(viewport.props!.scene.state.axesVisible).toBe(false);
    expect(viewport.props!.cameraRequestKey).toBe(4);
    expect(viewport.props!.sceneKey).toBe(sceneKey);
    expect(viewport.props!.readOnly).toBe(true);
  });

  it("retains the previous model and displays a retryable notice when persistence rejects an update", async () => {
    const rig = await mount({ save: async () => { throw new Error("storage unavailable"); } });
    await click("[data-cube-hit]");
    expect(rig.sent).toHaveLength(1);
    expect(viewport.props!.scene.state.cubes).toHaveLength(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("This action was not saved");
    expect(host.querySelector('[data-cube-structures-workbench]')?.hasAttribute("inert")).toBe(false);
  });

  it("publishes the current playback step rather than running independent follower timers", async () => {
    vi.useFakeTimers();
    const rig = await mount({ recorded: true });
    await click(`button[aria-label="${labels.record}"]`);
    await click(`button[aria-label="${labels.play}"]`);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0].session.preview).toBe(0);
    await act(async () => vi.advanceTimersByTime(1500));
    expect(rig.sent).toHaveLength(2);
    expect(rig.sent[1].session.preview).toBe(1);
    expect(viewport.props!.scene.state.axesVisible).toBe(false);
  });
});
