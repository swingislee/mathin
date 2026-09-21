import { describe, expect, it } from "vitest";
import { tools } from "@/features/tools/registry";
import { freezeToolScene, parseToolScene, toolSceneCatalogId } from "@/features/tools/scenes/contract";
import { getToolSceneDefinition, toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { toolSceneRuntime } from "@/features/tools/scenes/runtime";
import { createClassroomToolState, parseClassroomToolState, coursewareToolOriginHash } from "@/features/tools/courseware/tool-classroom";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { CUBE_NET_EXPLORATION_VERSION, cubeNetExplorationInitialSchema, cubeNetExplorationToolSchema, cubeNetExplorationStateSchema, NET_TEACHING_VERSION, netTeachingToolSchema, netInitialState } from "@/features/tools/net-teaching/contract";
import { createNetTeachingInitial } from "@/features/tools/net-teaching/defaults";
import { createDefaultSolidNetsSnapshot, createDefaultSolidNetsTeachingSnapshot, solidNetsSnapshotSchema, solidNetsTeachingSnapshotSchema, solidNetsToolSchema, SOLID_NETS_LESSON_VERSION, SOLID_NET_KINDS } from "@/features/tools/solid-nets/contract";
import { solidNetGeometry } from "@/features/tools/solid-nets/geometry";
import { resolveSolidNet, solidNetAllMotion } from "@/features/tools/solid-nets/model";
import { createDefaultPaperFoldingSnapshot } from "@/features/tools/paper-folding/contract";
import { buildNet, netTool } from "./fixtures/spatial-teaching-content";

const cube = () => cubeNetExplorationToolSchema.parse({ toolId: "spatial-lab", contentVersion: CUBE_NET_EXPLORATION_VERSION,
  payload: { title: "Cube exploration", initial: { mode: "free-paper", data: createDefaultPaperFoldingSnapshot() } } });
const solid = () => solidNetsToolSchema.parse({ toolId: "solid-nets", contentVersion: SOLID_NETS_LESSON_VERSION,
  payload: { title: "Solid nets", initial: createDefaultSolidNetsTeachingSnapshot() } });

describe("independent cube exploration and solid-net tools", () => {
  it("offers exactly one entry per tool in the library and both preparation surfaces", () => {
    expect(tools.filter((tool) => ["cube-net", "solid-nets"].includes(tool.id)).map((tool) => tool.id)).toEqual(["cube-net", "solid-nets"]);
    expect(new Set(tools.map((tool) => tool.no)).size).toBe(tools.length);
    expect(getToolSceneDefinition("cube-net")!.contentVersion).toBe(CUBE_NET_EXPLORATION_VERSION);
    expect(getToolSceneDefinition("solid-nets")!.contentVersion).toBe(SOLID_NETS_LESSON_VERSION);
    for (const surface of ["microcourse", "formal-courseware"] as const) {
      const definitions = toolCoursewareContractsForSurface(surface);
      expect(definitions.filter((entry) => entry.catalogId === "cube-net")).toHaveLength(1);
      expect(definitions.filter((entry) => entry.catalogId === "solid-nets")).toHaveLength(1);
    }
  });
  it("keeps the eleven-net source and free paper, with no other-solid mode in new cube scenes or events", async () => {
    for (const mode of ["standard", "free-paper"] as const) {
      const initial = cubeNetExplorationInitialSchema.parse(await createNetTeachingInitial(mode));
      expect(cubeNetExplorationStateSchema.parse(netInitialState(initial)).mode).toBe(mode);
      expect(parseToolScene({ ...cube(), payload: { title: "Cube", initial } }).contentVersion).toBe(CUBE_NET_EXPLORATION_VERSION);
    }
    const mixed = { mode: "solid-net", data: createDefaultSolidNetsSnapshot() };
    expect(cubeNetExplorationInitialSchema.safeParse(mixed).success).toBe(false);
    expect(cubeNetExplorationStateSchema.safeParse(mixed).success).toBe(false);
    expect(() => parseToolScene({ ...cube(), payload: { title: "Mixed", initial: mixed } })).toThrow();
  });
  it("retains original v1 and all mixed v2 copies without changing identity or snapshot version", async () => {
    const old = netTool(await buildNet());
    expect(parseToolScene(old)).toEqual(old);
    for (const mode of ["standard", "free-paper", "solid-net"] as const) {
      const initial = await createNetTeachingInitial(mode);
      const legacy = netTeachingToolSchema.parse({ toolId: "spatial-lab", contentVersion: NET_TEACHING_VERSION, payload: { title: "Legacy", initial } });
      expect(parseToolScene(legacy)).toEqual(legacy);
      expect(toolSceneCatalogId(legacy)).toBe("cube-net");
      expect(freezeToolScene(legacy)).toEqual(legacy);
    }
    expect(solidNetsSnapshotSchema.safeParse(createDefaultSolidNetsTeachingSnapshot()).success).toBe(false);
    expect(solidNetsSnapshotSchema.safeParse({ ...createDefaultSolidNetsSnapshot(), kind: "cube" }).success).toBe(false);
  });
  it.each(SOLID_NET_KINDS)("roundtrips %s into its own solid-net scene with shared folding geometry", (kind) => {
    const initial = createDefaultSolidNetsTeachingSnapshot(kind);
    const scene = solidNetsToolSchema.parse({ ...solid(), payload: { title: kind, initial } });
    expect(toolSceneCatalogId(scene)).toBe("solid-nets");
    expect(parseToolScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    const motion = solidNetAllMotion(initial, true);
    const middle = motion.sample(220);
    expect(middle.angles["base-left"]).toBeGreaterThan(0);
    expect(middle.angles["base-left"]).toBeLessThan(motion.target.angles["base-left"]);
    expect(solidNetsTeachingSnapshotSchema.parse(motion.target)).toEqual(motion.target);
    const opening = solidNetAllMotion(motion.target, false);
    expect(opening.sample(opening.durationMs)).toEqual(initial);
    expect(resolveSolidNet(motion.target).model.faces).toHaveLength(kind === "triangular-prism" ? 5 : 6);
  });
  it("uses the same cuboid geometry for a cube and rejects unequal cube dimensions", () => {
    const initial = createDefaultSolidNetsTeachingSnapshot();
    expect(solidNetGeometry("cube", initial.dimensions)).toEqual(solidNetGeometry("cuboid", initial.dimensions));
    expect(solidNetsTeachingSnapshotSchema.safeParse({ ...initial, dimensions: { ...initial.dimensions, height: 3 } }).success).toBe(false);
  });
  it("freezes independent blocks and separates their classroom state, restore and late-join identities", () => {
    const exploration = cube(), nets = solid();
    let page = createEmptyCoursewareCompositionPage();
    for (const scene of [exploration, nets]) page = addCoursewareCompositionTool(page, freezeToolScene(scene));
    expect(coursewareCompositionPageSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
    const changed = solidNetAllMotion(nets.payload.initial, true).target;
    const solidUpdate = { toolId: "solid-nets" as const, contentVersion: SOLID_NETS_LESSON_VERSION, state: solidNetsTeachingSnapshotSchema.parse(changed) };
    const cubeUpdate = { toolId: "spatial-lab" as const, contentVersion: CUBE_NET_EXPLORATION_VERSION, state: cubeNetExplorationStateSchema.parse(netInitialState(exploration.payload.initial)) };
    for (const [scene, update] of [[nets, solidUpdate], [exploration, cubeUpdate]] as const) {
      const event = createClassroomToolState("page", "doc", "instance", update, coursewareToolOriginHash(scene.payload));
      expect(parseClassroomToolState(event)).toEqual(event);
      expect(parseClassroomToolState({ ...event, toolId: "incorrect" })).toBeNull();
      expect(toolSceneRuntime(scene, { state: update })?.onChange).toBeUndefined();
    }
    expect(toolSceneRuntime<typeof SOLID_NETS_LESSON_VERSION>(nets, { state: cubeUpdate })?.state).toBeUndefined();
    expect(toolSceneRuntime<typeof CUBE_NET_EXPLORATION_VERSION>(exploration, { state: solidUpdate })?.state).toBeUndefined();
    expect(nets.payload.initial.angles["base-left"]).toBe(0);
    const reset = createClassroomToolState("page", "doc", "instance", { ...solidUpdate, state: nets.payload.initial }, coursewareToolOriginHash(nets.payload));
    expect(parseClassroomToolState(reset)?.state).toEqual(nets.payload.initial);
  });
});
