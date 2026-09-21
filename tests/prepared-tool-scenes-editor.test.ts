// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { ToolSceneEditor } from "@/features/tools/scenes/ToolSceneEditor";
import { fractionCoursewareSchema, initialFractionScene, initialMotionScene, motionCoursewareSchema } from "@/features/tools/scenes/numeric-teaching-content";
import { buildNet, diceTool, netTool } from "./fixtures/spatial-teaching-content";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession, operateCubeSession, startCubeRecording } from "@/features/tools/spatial-lab/cube-structures-session";
import { cubeCoursewareInitialSession } from "@/features/tools/courseware/cube-structures-classroom";
import { projectionTool } from "./fixtures/projection-tool";
import type { ToolScene } from "@/features/tools/scenes/contract";
import { createSolidGeometryInitial, solidGeometryToolSchema } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { createDefaultSolidCapacityInitial, solidCapacityToolSchema } from "@/features/tools/solid-capacity/solid-capacity-contract";
import { createSomaInitial } from "@/features/tools/soma-cube/model";
import { SOMA_VERSION, SOMA_LEGACY_VERSION, somaToolSchema, somaLegacyToolSchema } from "@/features/tools/soma-cube/contract";
import { cubeNetExplorationToolSchema, CUBE_NET_EXPLORATION_VERSION, netTeachingToolSchema, NET_TEACHING_VERSION } from "@/features/tools/net-teaching/contract";
import { createDefaultPaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { createDefaultSolidNetsSnapshot, createDefaultSolidNetsTeachingSnapshot, solidNetsToolSchema, SOLID_NETS_LESSON_VERSION } from "@/features/tools/solid-nets/contract";

const workspace = vi.hoisted(() => ({ current: null as null | { initial?: unknown; payload?: unknown; preparation?: boolean; freeRotation?: boolean; onSnapshot: (snapshot: unknown) => void } }));
const library = vi.hoisted(() => ({ open: null as null | ((scene: ToolScene) => void) }));
vi.mock("next/dynamic", () => ({ default: () => function OriginalWorkspaceStub(props: NonNullable<typeof workspace.current>) { workspace.current = props; return null; } }));
vi.mock("@/features/tools/scenes/ToolSceneLibrary", () => ({ ToolSceneLibrary: ({ title, children, onOpen }: { title: ReactNode; children: ReactNode; onOpen: (scene: ToolScene) => void }) => { library.open = onOpen; return createElement(Fragment, null, title, children); } }));
let root: Root, host: HTMLDivElement;
function renderEditor(props: Parameters<typeof ToolSceneEditor>[0]) {
  // eslint-disable-next-line react/no-children-prop
  return act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: createElement(ToolSceneEditor, props) })));
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); workspace.current = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("shared starting-scene editor", () => {
  it.each([
    cubeNetExplorationToolSchema.parse({ toolId: "spatial-lab", contentVersion: CUBE_NET_EXPLORATION_VERSION, payload: { title: "Cube exploration", initial: { mode: "free-paper", data: createDefaultPaperFoldingSnapshot() } } }),
    solidNetsToolSchema.parse({ toolId: "solid-nets", contentVersion: SOLID_NETS_LESSON_VERSION, payload: { title: "Solid nets", initial: createDefaultSolidNetsTeachingSnapshot() } }),
    diceTool(),
    somaToolSchema.parse({ toolId: "soma-cube", contentVersion: SOMA_VERSION, payload: { title: "Soma", initial: createSomaInitial() } }),
    projectionTool(),
    solidGeometryToolSchema.parse({ toolId: "solid-geometry", contentVersion: "solid-geometry-lesson-v1", payload: { title: "Solids", initial: createSolidGeometryInitial() } }),
    solidCapacityToolSchema.parse({ toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v1", payload: { title: "Capacity", initial: createDefaultSolidCapacityInitial() } }),
    fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fractions", initial: initialFractionScene() } }),
    motionCoursewareSchema.parse({ toolId: "motion-lab", contentVersion: "motion-lab-lesson-v1", payload: { title: "Motion", initial: initialMotionScene() } }),
  ])("captures $toolId without reinitializing the original workbench or changing its source", async (scene) => {
    const ready = vi.fn();
    await act(async () => {
      // eslint-disable-next-line react/no-children-prop
      root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: createElement(ToolSceneEditor, { version: scene.contentVersion, existing: scene, onReady: ready }) }));
    });
    expect(ready.mock.lastCall![0]).toBeNull();
    const initial = workspace.current!.initial;
    expect(initial).toBe(scene.payload.initial);
    await act(async () => workspace.current!.onSnapshot(structuredClone(initial)));
    expect(ready.mock.lastCall![0]).toEqual(scene);
    expect(ready.mock.lastCall![0].payload.initial).not.toBe(initial);
    expect(workspace.current!.initial).toBe(initial);
    await act(async () => workspace.current!.onSnapshot(null));
    expect(ready.mock.lastCall![0]).toBeNull();
    expect(workspace.current!.initial).toBe(initial);
    expect(host.textContent).not.toContain(en.tools.preparation.wait);
    expect(host.querySelector('[data-tool-scene-configuration]')?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("restores a net through its own adapter and captures a detached fixed copy", async () => {
    const scene = netTool(await buildNet()), ready = vi.fn();
    await renderEditor({ version: scene.contentVersion, existing: scene, onReady: ready });
    const changed = { ...scene.payload.initial, axesVisible: false };
    await act(async () => workspace.current!.onSnapshot(changed));
    expect(ready.mock.lastCall![0]).toEqual({ ...scene, payload: { ...scene.payload, initial: changed } });
    expect(ready.mock.lastCall![0].payload.initial).not.toBe(changed);
    expect(workspace.current!.initial).toBe(scene.payload.initial);
    expect(scene.payload.initial.axesVisible).toBe(true);
  });

  it("opens a legacy prism without relabeling it as a new cube exploration or offering an invalid upgrade", async () => {
    const scene = netTeachingToolSchema.parse({ toolId: "spatial-lab", contentVersion: NET_TEACHING_VERSION,
      payload: { title: "Legacy prism", initial: { mode: "solid-net", data: createDefaultSolidNetsSnapshot("triangular-prism") } } });
    const ready = vi.fn(); await renderEditor({ version: CUBE_NET_EXPLORATION_VERSION, onReady: ready });
    await act(async () => library.open!(scene));
    expect(workspace.current!.initial).toEqual(scene.payload.initial);
    await act(async () => workspace.current!.onSnapshot(scene.payload.initial));
    expect(ready.mock.lastCall![0]).toEqual(scene);
    expect([...host.querySelectorAll("button")].some((button) => button.getAttribute("aria-label") === en.tools.preparation.upgradeCopy)).toBe(false);
    const before = workspace.current!.initial;
    const other = solidNetsToolSchema.parse({ toolId: "solid-nets", contentVersion: SOLID_NETS_LESSON_VERSION, payload: { title: "New solid", initial: createDefaultSolidNetsTeachingSnapshot() } });
    await act(async () => library.open!(other));
    expect(workspace.current!.initial).toBe(before);
  });

  it("updates the toolbar name and resets the workbench only when opening another scene", async () => {
    const scene = projectionTool(), ready = vi.fn();
    await renderEditor({ version: scene.contentVersion, existing: scene, onReady: ready, fullHeight: true });
    await act(async () => workspace.current!.onSnapshot(scene.payload.initial));
    const configuration = host.querySelector('[data-tool-scene-configuration]')!;
    const stage = configuration.firstElementChild;
    await act(async () => workspace.current!.onSnapshot(null));
    expect(configuration.firstElementChild).toBe(stage);
    expect(configuration.children).toHaveLength(1);
    expect(host.textContent).not.toContain(en.tools.preparation.wait);
    const opened = { ...scene, payload: { title: "Another projection", initial: { ...scene.payload.initial, guides: true } } };
    await act(async () => library.open!(opened));
    expect(host.querySelector("[data-tool-scene-name]")!.textContent).toBe(opened.payload.title);
    expect(host.querySelector("input")).toBeNull();
    expect(workspace.current!.initial).toBe(opened.payload.initial);
    expect(ready.mock.lastCall![0]).toBeNull();
    await act(async () => workspace.current!.onSnapshot(opened.payload.initial));
    expect(ready.mock.lastCall![0]).toEqual(opened);
  });

  it("keeps cube recordings and chosen toolbar in the cube adapter, with an explicit current-scene alternative", async () => {
    const recorded = operateCubeSession(startCubeRecording(createCubeSession([{ x: 0, y: 0, z: 0 }])), { kind: "axes", visible: false });
    const scene = createCubeCoursewareTool({ name: "Recorded cube", snapshot: cubeDraftSnapshot(recorded, 0) }, "recording", ["orbit", "recording", "reset"]);
    const ready = vi.fn();
    await renderEditor({ version: scene.contentVersion, existing: scene, onReady: ready });
    expect(workspace.current!.preparation).toBe(true);
    expect(workspace.current!.payload).toBe(scene.payload);
    const current = operateCubeSession(cubeCoursewareInitialSession(scene.payload), { kind: "axes", visible: false });
    await act(async () => workspace.current!.onSnapshot(current));
    expect(ready.mock.lastCall![0]).toEqual(scene);
    const useCurrent = [...host.querySelectorAll("button")].find((button) => button.textContent === en.tools.preparation.useCurrent)!;
    await act(async () => useCurrent.click());
    expect(ready.mock.lastCall![0].payload.history.operations).toEqual([]);
    expect(ready.mock.lastCall![0].payload.history.initial.axesVisible).toBe(false);
    expect(ready.mock.lastCall![0].payload.toolbar).toEqual(["orbit", "recording", "reset"]);
    expect(scene.payload.history.operations).toHaveLength(1);
    expect(workspace.current!.payload).toBe(scene.payload);
    await act(async () => workspace.current!.onSnapshot(null));
    expect(ready.mock.lastCall![0]).toBeNull();
  });

  it("starts a new editor session when the selected tool changes and never reuses the previous candidate", async () => {
    const dice = diceTool(), ready = vi.fn();
    await renderEditor({ version: dice.contentVersion, existing: dice, onReady: ready });
    await act(async () => workspace.current!.onSnapshot(dice.payload.initial));
    expect(ready.mock.lastCall![0]).toEqual(dice);
    const motion = motionCoursewareSchema.parse({ toolId: "motion-lab", contentVersion: "motion-lab-lesson-v1", payload: { title: "Three tracks", initial: initialMotionScene() } });
    await renderEditor({ version: motion.contentVersion, existing: motion, onReady: ready });
    expect(ready.mock.lastCall![0]).toBeNull();
    expect(workspace.current!.initial).toBe(motion.payload.initial);
    expect(host.querySelector("[data-tool-scene-name]")!.textContent).toBe("Three tracks");
    await act(async () => workspace.current!.onSnapshot(motion.payload.initial));
    expect(ready.mock.lastCall![0]).toEqual(motion);
  });

  it("opens old same-tool scenes unchanged and upgrades only after an explicit copy action", async () => {
    const scene = netTool(await buildNet()), ready = vi.fn();
    await renderEditor({ version: "cube-net-lesson-v2", onReady: ready });
    await act(async () => library.open!(scene));
    expect(workspace.current!.initial).toBe(scene.payload.initial);
    await act(async () => workspace.current!.onSnapshot(scene.payload.initial));
    expect(ready.mock.lastCall![0].contentVersion).toBe("cube-net-lesson-v1");
    const upgrade = host.querySelector<HTMLButtonElement>(`button[aria-label="${en.tools.preparation.upgradeCopy}"]`)!;
    expect(upgrade).not.toBeNull(); await act(async () => upgrade.click());
    expect(workspace.current!.initial).toEqual({ mode: "standard", data: scene.payload.initial });
    await act(async () => workspace.current!.onSnapshot(workspace.current!.initial));
    expect(ready.mock.lastCall![0].contentVersion).toBe("cube-net-lesson-v3");
    expect(scene.contentVersion).toBe("cube-net-lesson-v1");
  });
  it("keeps a legacy Soma scene on its adapter until the teacher explicitly copies it to v2", async () => {
    const scene = somaLegacyToolSchema.parse({ toolId: "soma-cube", contentVersion: SOMA_LEGACY_VERSION, payload: { title: "Old assembly", initial: createSomaInitial() } });
    const before = structuredClone(scene), ready = vi.fn();
    await renderEditor({ version: SOMA_VERSION, onReady: ready });
    expect(workspace.current!.freeRotation).toBe(true);
    await act(async () => library.open!(scene));
    expect(workspace.current!.freeRotation).toBe(false);
    await act(async () => workspace.current!.onSnapshot(scene.payload.initial));
    expect(ready.mock.lastCall![0]).toEqual(scene);
    const upgrade = host.querySelector<HTMLButtonElement>(`button[aria-label="${en.tools.preparation.upgradeCopy}"]`)!;
    expect(upgrade).not.toBeNull(); await act(async () => upgrade.click());
    expect(workspace.current!.freeRotation).toBe(true); expect(workspace.current!.initial).toEqual(scene.payload.initial);
    await act(async () => workspace.current!.onSnapshot(workspace.current!.initial));
    expect(ready.mock.lastCall![0].contentVersion).toBe(SOMA_VERSION); expect(scene).toEqual(before);
  });
});
