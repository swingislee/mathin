import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_SCENE_DEFINITIONS } from "@/features/tools/scenes/registry";
import { getToolWorkbenchAdapter } from "@/features/tools/scenes/workbench-registry";
import { defineToolWorkbenchAdapter } from "@/features/tools/scenes/workbench-adapter";
import { ToolScenePresentation } from "@/features/tools/scenes/ToolScenePresentation";
import { toolSceneRuntime } from "@/features/tools/scenes/runtime";
import { toolClassroomEventSchema, toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { fractionCoursewareSchema, initialFractionScene, initialMotionScene, motionCoursewareSchema } from "@/features/tools/scenes/numeric-teaching-content";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate, type CoursewareToolRuntime } from "@/features/tools/courseware/tool-classroom";
import type { CubeCoursewareRuntime } from "@/features/tools/courseware/cube-structures-classroom";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { buildNet, diceTool, netTool } from "./fixtures/spatial-teaching-content";
import { projectionTool } from "./fixtures/projection-tool";
import { projectionSnapshot } from "@/features/tools/projection/projection-contract";

const rendered = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("next/dynamic", () => ({ default: () => function WorkspaceStub(props: Record<string, unknown>) { rendered.push(props); return null; } }));
const fraction = () => fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fraction", initial: initialFractionScene() } });
const motion = () => motionCoursewareSchema.parse({ toolId: "motion-lab", contentVersion: "motion-lab-lesson-v1", payload: { title: "Motion", initial: initialMotionScene() } });
afterEach(() => { rendered.length = 0; vi.unstubAllGlobals(); });

describe("Tools workbench registration boundary", () => {
  it("registers preparation and classroom for each authoring tool; legacy import remains an optional tool capability", () => {
    for (const definition of TOOL_SCENE_DEFINITIONS) {
      const adapter = getToolWorkbenchAdapter(definition.contentVersion);
      expect(adapter.contentVersion).toBe(definition.contentVersion);
      expect(adapter.Preparation).toBeTypeOf("function");
      expect(adapter.Presentation).toBeTypeOf("function");
      expect(!!adapter.Import).toBe(definition.catalogId === "cube-structures");
    }
  });

  it("rejects an incorrectly selected workbench before passing another tool's parameters to it", () => {
    const adapter = defineToolWorkbenchAdapter({ contentVersion: "fraction-line-lesson-v1", Preparation: () => null, Presentation: () => null });
    expect(() => renderToStaticMarkup(createElement(adapter.Preparation, { existing: motion(), title: "Wrong", fullHeight: false, onChange: () => {} }))).toThrow("TOOL_SCENE_ADAPTER_MISMATCH");
    expect(() => renderToStaticMarkup(createElement(adapter.Presentation, { scene: motion() }))).toThrow("TOOL_SCENE_ADAPTER_MISMATCH");
    expect(() => renderToStaticMarkup(createElement(adapter.Preparation, { existing: fraction(), title: "Ready", fullHeight: false, onChange: () => {} }))).not.toThrow();
  });

  it("dispatches all fixed scenes without mounting the preparation library or reading personal drafts", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const cube = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current");
    const scenes = [cube, netTool(await buildNet()), diceTool(), fraction(), motion(), projectionTool()];
    for (const scene of scenes) {
      rendered.length = 0;
      renderToStaticMarkup(createElement(ToolScenePresentation, { scene }));
      expect(rendered).toHaveLength(1);
      if (scene.contentVersion === "projection-lesson-v1") {
        expect(rendered[0].initial).toBe(scene.payload.initial);
        expect(rendered[0].readOnly).toBe(true);
      } else expect(rendered[0].tool ?? rendered[0].payload).toBe(scene.contentVersion === "cube-structures-lesson-v2" ? scene.payload : scene);
      expect(rendered[0].classroom).toBeUndefined();
      expect(rendered[0].preparation).toBeUndefined();
      expect(rendered[0].onSnapshot).toBeUndefined();
      const onChange = vi.fn<NonNullable<CoursewareToolRuntime["onChange"]>>().mockResolvedValue(undefined);
      const classroom = { onChange };
      rendered.length = 0;
      renderToStaticMarkup(createElement(ToolScenePresentation, { scene, classroom }));
      if (scene.contentVersion === "cube-structures-lesson-v2") {
        const state = { session: createCubeSession([{ x: 0, y: 0, z: 0 }]), view: null, cameraRevision: 0 };
        await (rendered[0].classroom as CubeCoursewareRuntime).onChange!(state);
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ toolId: scene.toolId, contentVersion: scene.contentVersion, state });
      } else if (scene.contentVersion === "projection-lesson-v1") {
        const state = projectionSnapshot(scene.payload.initial);
        await (rendered[0].classroom as { onChange: (state: unknown) => Promise<void> }).onChange(state);
        expect(onChange).toHaveBeenCalledExactlyOnceWith({ toolId: "projection", contentVersion: scene.contentVersion, state });
        expect(rendered[0].readOnly).toBe(false);
      } else expect(rendered[0].classroom).toBe(classroom);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("tool-neutral classroom envelope and runtime", () => {
  it("can describe another mathematical tool without inheriting cube state, while the live registry remains fail-closed", () => {
    const schema = toolClassroomEventSchema("test-ruler", "test-ruler-v1", z.object({ length: z.number().positive() }).strict());
    const value = { schema: "mathin-classroom-tool-state", version: 1, pageId: "page", docId: "doc", instanceId: "instance", originHash: "a".repeat(64), toolId: "test-ruler", contentVersion: "test-ruler-v1", state: { length: 10 } };
    expect(schema.parse(value)).toEqual(value);
    for (const changed of [{ ...value, instanceId: "__proto__" }, { ...value, draftId: "private" }, { ...value, state: { length: -1 } }, { ...value, toolId: "spatial-lab" }]) {
      expect(schema.safeParse(changed).success).toBe(false);
    }
    expect(parseClassroomToolState(value)).toBeNull();
    expect(toolSceneOriginHash({ b: [2, 1], a: "教学" })).toBe(createHash("sha256").update('{"a":"教学","b":[2,1]}').digest("hex"));
  });

  it("binds only matching runtime identities, preserves read-only viewers, and propagates durable write failures", async () => {
    const scene = motion();
    const update: ClassroomToolUpdate = { toolId: scene.toolId, contentVersion: scene.contentVersion, state: { id: "current", snapshot: scene.payload.initial, motion: null, settles: null } };
    const onChange = vi.fn().mockResolvedValue(undefined);
    const runtime = toolSceneRuntime<"motion-lab-lesson-v1">(scene, { state: update, onChange })!;
    expect(runtime.state).toBe(update.state);
    await runtime.onChange!(update.state);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(update);
    const packet = createClassroomToolState("page", "doc", "instance", onChange.mock.calls[0][0], "a".repeat(64));
    expect(parseClassroomToolState(packet)).toEqual(packet);
    expect(toolSceneRuntime<"motion-lab-lesson-v1">(scene)).toBeUndefined();
    expect(toolSceneRuntime<"motion-lab-lesson-v1">(scene, { state: update })?.onChange).toBeUndefined();
    expect(toolSceneRuntime<"fraction-line-lesson-v1">(fraction(), { state: update })?.state).toBeUndefined();
    onChange.mockRejectedValueOnce(new Error("offline"));
    await expect(runtime.onChange!(update.state)).rejects.toThrow("offline");
  });
});
