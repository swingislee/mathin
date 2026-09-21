import { describe, expect, it } from "vitest";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { getToolSceneDefinition, toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { hasClassroomToolAdapter, createClassroomToolState, coursewareToolOriginHash, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { createCurvedNet, createDefaultSolidNetsComplete, SOLID_NETS_COMPLETE_VERSION } from "@/features/tools/solid-nets/curved-contract";
import { createDefaultSolidCapacityTeachingInitial, solidCapacityTeachingSnapshot, SOLID_CAPACITY_TEACHING_VERSION } from "@/features/tools/solid-capacity/solid-capacity-teaching-contract";
import { createSolidGeometryExplorationInitial, solidGeometryExplorationSnapshot, SOLID_GEOMETRY_EXPLORATION_VERSION } from "@/features/tools/solid-geometry/exploration-contract";
import { createDefaultSolidRevolutionInitial, solidRevolutionSnapshot, SOLID_REVOLUTION_VERSION } from "@/features/tools/solid-revolution/contract";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { addCoursewareCompositionTool } from "@/features/courseware-doc/composition-page-layout";
import { getTool } from "@/features/tools/registry";

const capacity = createDefaultSolidCapacityTeachingInitial(), geometry = createSolidGeometryExplorationInitial(), revolution = createDefaultSolidRevolutionInitial();
const examples = [
  { toolId: "solid-nets", contentVersion: SOLID_NETS_COMPLETE_VERSION, initial: createDefaultSolidNetsComplete(), state: createDefaultSolidNetsComplete() },
  { toolId: "solid-nets", contentVersion: SOLID_NETS_COMPLETE_VERSION, initial: { mode: "curved", data: createCurvedNet("cone") }, state: { mode: "curved", data: createCurvedNet("cone") } },
  { toolId: "solid-capacity", contentVersion: SOLID_CAPACITY_TEACHING_VERSION, initial: capacity, state: solidCapacityTeachingSnapshot(capacity) },
  { toolId: "solid-geometry", contentVersion: SOLID_GEOMETRY_EXPLORATION_VERSION, initial: geometry, state: solidGeometryExplorationSnapshot(geometry) },
  { toolId: "solid-revolution", contentVersion: SOLID_REVOLUTION_VERSION, initial: revolution, state: solidRevolutionSnapshot(revolution) },
];
describe("complete solid teaching batch on the common preparation and classroom path", () => {
  it.each(examples)("round trips $toolId/$contentVersion without domain-specific host logic", (example) => {
    const scene = parseToolScene({ toolId: example.toolId, contentVersion: example.contentVersion, payload: { title: "Prepared scene", initial: example.initial } });
    expect(getTool(example.toolId)).toBeDefined(); expect(hasClassroomToolAdapter(scene)).toBe(true);
    expect(getToolSceneDefinition(example.toolId)?.contentVersion).toBe(example.contentVersion);
    const frozen = freezeToolScene(scene), page = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), frozen);
    expect(coursewareCompositionPageSchema.parse(page)).toEqual(page);
    const update = { toolId: example.toolId, contentVersion: example.contentVersion, state: structuredClone(example.state) } as ClassroomToolUpdate;
    const event = createClassroomToolState("page", "doc", "instance", update, coursewareToolOriginHash(scene.payload));
    expect(parseClassroomToolState(event)?.state).toEqual(example.state);
    expect(parseClassroomToolState({ ...event, state: { ...example.state, foreignState: true } })).toBeNull();
    expect(parseToolScene(JSON.parse(JSON.stringify(frozen)))).toEqual(scene);
    expect(frozen).not.toBe(scene); expect(frozen.payload).not.toBe(scene.payload);
  });
  it("keeps independent cube exploration and excludes the next-stage planar tools", () => {
    for (const surface of ["microcourse", "formal-courseware"] as const) {
      const defs = toolCoursewareContractsForSurface(surface);
      expect(new Set(defs.map((d) => d.catalogId)).size).toBe(defs.length);
      expect(defs.find((d) => d.catalogId === "cube-net")?.contentVersion).toBe("cube-net-lesson-v3");
      expect(defs.find((d) => d.catalogId === "solid-nets")?.contentVersion).toBe(SOLID_NETS_COMPLETE_VERSION);
      expect(defs.some((d) => /plane|planar|dissection/.test(d.catalogId))).toBe(false);
    }
  });
});
