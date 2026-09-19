import { describe, expect, it } from "vitest";
import { freezeToolScene, parseToolScene, toolSceneCatalogId } from "@/features/tools/scenes/contract";
import { getToolSceneDefinition, toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, coursewareToolOriginHash } from "@/features/tools/courseware/tool-classroom";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { createCubeCoursewareTool, cubeCoursewareV2ToolSchema } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession, cubeSessionScene, operateCubeSession, startCubeRecording } from "@/features/tools/spatial-lab/cube-structures-session";
import { cubeRotationOperation } from "@/features/tools/spatial-lab/cube-structures-rotation";
import { createSolidGeometryInitial, solidGeometryToolSchema, solidGeometrySnapshot } from "@/features/tools/solid-geometry/solid-geometry-contract";
import { NET_TEACHING_VERSION, netTeachingToolSchema, netInitialState } from "@/features/tools/net-teaching/contract";
import { createDefaultPaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { createDefaultSolidNetsSnapshot } from "@/features/tools/solid-nets/contract";
import { createDefaultSolidCapacityInitial, solidCapacityToolSchema, solidCapacitySnapshot } from "@/features/tools/solid-capacity/solid-capacity-contract";
import { buildNet, netTool } from "./fixtures/spatial-teaching-content";

const solid = () => solidGeometryToolSchema.parse({ toolId: "solid-geometry", contentVersion: "solid-geometry-lesson-v1", payload: { title: "Solid comparison", initial: createSolidGeometryInitial() } });
const paper = () => netTeachingToolSchema.parse({ toolId: "spatial-lab", contentVersion: NET_TEACHING_VERSION, payload: { title: "Paper", initial: { mode: "free-paper", data: createDefaultPaperFoldingSnapshot() } } });
const capacity = () => solidCapacityToolSchema.parse({ toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v1", payload: { title: "Capacity", initial: createDefaultSolidCapacityInitial() } });

describe("teaching spaces use one preparation and classroom boundary", () => {
  it("keeps one authoring entry per tool while old frozen versions remain readable", async () => {
    expect(getToolSceneDefinition("cube-structures")!.contentVersion).toBe("cube-structures-lesson-v3");
    expect(getToolSceneDefinition("cube-net")!.contentVersion).toBe(NET_TEACHING_VERSION);
    const definitions = toolCoursewareContractsForSurface("formal-courseware");
    expect(new Set(definitions.map((entry) => entry.catalogId)).size).toBe(definitions.length);
    const oldNet = netTool(await buildNet());
    expect(parseToolScene(oldNet)).toEqual(oldNet);
    expect(toolSceneCatalogId(oldNet)).toBe("cube-net");
    const updated = netTeachingToolSchema.parse({ ...oldNet, contentVersion: NET_TEACHING_VERSION, payload: { ...oldNet.payload, initial: { mode: "standard", data: oldNet.payload.initial } } });
    expect(updated.payload.initial).toEqual({ mode: "standard", data: oldNet.payload.initial });
    expect(oldNet.contentVersion).toBe("cube-net-lesson-v1");
  });
  it("isolates rotation history in the new version instead of widening published cube contracts", () => {
    let session = startCubeRecording(createCubeSession([{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }]));
    const op = cubeRotationOperation(cubeSessionScene(session), ["cube-1", "cube-2"], "y", 1)!;
    session = operateCubeSession(session, op);
    const scene = createCubeCoursewareTool({ name: "Rotate group", snapshot: cubeDraftSnapshot(session, 0) }, "recording");
    expect(scene.contentVersion).toBe("cube-structures-lesson-v3");
    expect(scene.payload.history.version).toBe("cube-structures-draft-v4");
    expect(parseToolScene(scene)).toEqual(scene);
    expect(cubeCoursewareV2ToolSchema.safeParse({ ...scene, contentVersion: "cube-structures-lesson-v2" }).success).toBe(false);
    const event = createClassroomToolState("page", "doc", "instance", { toolId: "spatial-lab", contentVersion: "cube-structures-lesson-v3", state: { session, view: null, cameraRevision: 0 } }, coursewareToolOriginHash(scene.payload));
    expect(parseClassroomToolState(event)).toEqual(event);
    expect(parseClassroomToolState({ ...event, contentVersion: "cube-structures-lesson-v2" })).toBeNull();
  });
  it("freezes paper, prism and solid scenes into normal courseware blocks without private pointers", () => {
    const prism = netTeachingToolSchema.parse({ ...paper(), payload: { title: "Prism", initial: { mode: "solid-net", data: createDefaultSolidNetsSnapshot("triangular-prism") } } });
    for (const scene of [paper(), prism, solid(), capacity()]) {
      const frozen = freezeToolScene(scene);
      const page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), frozen);
      expect(coursewareCompositionPageSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
      expect(frozen).not.toBe(scene);
      expect(parseToolScene({ ...scene })).toEqual(scene);
      expect(() => parseToolScene({ ...scene, payload: { ...scene.payload, draftId: "private" } })).toThrow();
    }
    const wrong = { ...paper(), payload: { ...paper().payload, initial: { mode: "solid-net", data: paper().payload.initial.data } } };
    expect(() => parseToolScene(wrong)).toThrow();
  });
  it("restores the selected folding mode and solid parameters through the shared event envelope", () => {
    const scene = paper();
    const update = { toolId: "spatial-lab" as const, contentVersion: NET_TEACHING_VERSION, state: netInitialState(scene.payload.initial) };
    const event = createClassroomToolState("page", "doc", "paper", update, coursewareToolOriginHash(scene.payload));
    expect(parseClassroomToolState(event)).toEqual(event);
    expect(parseClassroomToolState({ ...event, contentVersion: "cube-net-lesson-v1" })).toBeNull();
    const geometry = solid();
    const next = solidGeometrySnapshot(geometry.payload.initial); next.entities[0].opacity = 0.25;
    const geometryEvent = createClassroomToolState("page", "doc", "solid", { toolId: "solid-geometry", contentVersion: "solid-geometry-lesson-v1", state: next }, coursewareToolOriginHash(geometry.payload));
    expect(parseClassroomToolState(geometryEvent)).toEqual(geometryEvent);
    expect(geometry.payload.initial.entities[0].opacity).toBe(1);
    const containers = capacity();
    const capacityEvent = createClassroomToolState("page", "doc", "capacity", { toolId: "solid-capacity", contentVersion: "solid-capacity-lesson-v1", state: solidCapacitySnapshot(containers.payload.initial) }, coursewareToolOriginHash(containers.payload));
    expect(parseClassroomToolState(capacityEvent)).toEqual(capacityEvent);
    expect(parseClassroomToolState({ ...capacityEvent, toolId: "solid-geometry" })).toBeNull();
  });
});
