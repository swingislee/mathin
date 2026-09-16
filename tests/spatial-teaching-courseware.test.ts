import { readFileSync } from "node:fs";
import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import { createEmptyCoursewareCompositionPage, coursewareCompositionPageSchema } from "@/features/courseware-doc/composition-page-schema";
import { collectCoursewareDocBindingKeys, parseCoursewareDoc } from "@/features/courseware-doc/document";
import { formalCubePageSchema } from "@/features/courseware-studio/formal-cube-page-contract";
import { formalManualPageSchema } from "@/features/courseware-studio/formal-manual-page-contract";
import { resolveClassroomInteractionAudit } from "@/features/classroom/sync/interaction-audit";
import { cubeNetTeachingSnapshotSchema, diceSceneSchema, spatialTeachingToolSchema, NET_EDGE_IDS } from "@/features/tools/courseware/spatial-teaching-content";
import { CUBE_COLORS } from "@/features/tools/spatial-lab/cube-structures-contract";
import { buildCubeNetFromCuts } from "@/features/tools/spatial-lab/cube-net-cutting";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { DEFAULT_CUBE_NET_FACE_STYLE } from "@/features/tools/spatial-lab/cube-net-surfaces";
import { controlledRoll, createDie } from "@/features/tools/spatial-lab/dice-teaching-model";
import { buildNet, diceTool, legalNetEntries, netTool } from "./fixtures/spatial-teaching-content";

describe("frozen cube-net and dice courseware", () => {
  it("pins all eleven catalog identities and hinge sets to the existing builder", async () => {
    const entries = legalNetEntries();
    expect(entries).toHaveLength(11);
    for (const entry of entries) {
      const build = await buildNet(entry.id), tool = netTool(build);
      expect(spatialTeachingToolSchema.parse(JSON.parse(JSON.stringify(tool)))).toEqual(tool);
      expect(Object.keys(tool.payload.initial.angles)).toEqual(build.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId));
      expect(spatialTeachingToolSchema.safeParse({ ...tool, payload: { ...tool.payload, initial: { ...tool.payload.initial, source: { entryId: "cube-net-gallery.01", cuts: null } } } }).success).toBe(false);
    }
  }, 15_000);

  it("roundtrips a partial cut, a posed face, markings, and a reconstructed custom net", async () => {
    const base = await buildNet(), tool = netTool(base), initial = tool.payload.initial;
    const hinges = base.sceneInput.hingeGraph.hinges.map((hinge) => hinge.edgeId);
    const cuts = NET_EDGE_IDS.filter((edge) => !hinges.includes(edge));
    const closed = Object.fromEntries(hinges.map((edge) => [edge, 90]));
    const support = createCubeNetWorkbenchResolver(base, "en").resolve(closed).model.faces[2];
    const surfaces = { faces: { A: { ...DEFAULT_CUBE_NET_FACE_STYLE, color: CUBE_COLORS[1], opacity: 0.4, number: { value: 7, color: CUBE_COLORS[2] } } }, nextNumber: 8 };
    const snapshot = cubeNetTeachingSnapshotSchema.parse({ ...initial, angles: closed, surfaces,
      anchor: { faceId: support.faceId, vertices: support.vertices.slice(0, 3).map((vertex) => vertex.position) },
      cutting: { cuts: cuts.slice(0, 3), poses: { [support.faceId]: new Matrix4().makeTranslation(0, -0.9, 0).toArray() }, surfaces },
      revealEnabled: true, faceOffsets: { [support.faceId]: 1 },
    });
    expect(cubeNetTeachingSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    const rebuilt = await buildCubeNetFromCuts(base, cuts);
    const custom = cubeNetTeachingSnapshotSchema.parse({ ...snapshot, source: { entryId: base.entry.id, cuts }, cutting: null, revealEnabled: false, faceOffsets: {} });
    const before = createCubeNetWorkbenchResolver(base, "en").resolve(closed, null, custom.anchor).model;
    const after = createCubeNetWorkbenchResolver(rebuilt, "en").resolve(custom.angles, null, custom.anchor).model;
    for (const face of after.faces) for (const vertex of face.vertices) {
      const point = before.faces.find((item) => item.faceId === face.faceId)!.vertices.find((item) => item.vertexId === vertex.vertexId)!.position;
      expect(vertex.position.x).toBeCloseTo(point.x); expect(vertex.position.y).toBeCloseTo(point.y); expect(vertex.position.z).toBeCloseTo(point.z);
    }
    expect(cubeNetTeachingSnapshotSchema.safeParse({ ...snapshot, cutting: { ...snapshot.cutting, poses: { [support.faceId]: new Matrix4().makeScale(2, 1, 1).toArray() } } }).success).toBe(false);
    expect(cubeNetTeachingSnapshotSchema.safeParse({ ...snapshot, anchor: { ...snapshot.anchor, vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }] } }).success).toBe(false);
    const detached = NET_EDGE_IDS.slice(0, 5);
    expect(cubeNetTeachingSnapshotSchema.safeParse({ ...initial, source: { ...initial.source, cuts: NET_EDGE_IDS.filter((edge) => !detached.includes(edge)) }, angles: Object.fromEntries(detached.map((edge) => [edge, 0])) }).success).toBe(false);
  });

  it("preserves both dice hands, hidden pips, face styles, displacement and controlled-roll footprints", () => {
    const tool = diceTool(), initial = tool.payload.initial;
    const die = initial.scene.dice[0];
    initial.scene.dice = [{ ...die, hidden: ["y-"], offsets: { "y-": 0.9 }, surfaces: { "x+": { color: CUBE_COLORS[1], opacity: 0.25 } } },
      { ...createDie("dice-2", "left", { x: 4, y: 0.5, z: 0 }), hidden: [], offsets: {} }];
    initial.scene.nextId = 3;
    initial.scene = diceSceneSchema.parse(controlledRoll(initial.scene, "dice-2", "z+", true));
    initial.view = "bottom";
    expect(initial.scene.trail).toHaveLength(2);
    const restored = spatialTeachingToolSchema.parse(JSON.parse(JSON.stringify(tool)));
    expect(restored).toEqual(tool);
    initial.scene.dice[0].hidden = [];
    expect(restored.contentVersion === "dice-lesson-v1" && restored.payload.initial.scene.dice[0].hidden).toEqual(["y-"]);
    const reject = (scene: unknown) => expect(spatialTeachingToolSchema.safeParse({ ...tool, payload: { ...tool.payload, initial: { ...initial, scene } } }).success).toBe(false);
    reject({ ...initial.scene, dice: [die, die] });
    reject({ ...initial.scene, dice: [{ ...die, rotation: { x: 0, y: 0, z: 0, w: 0 } }] });
    reject({ ...initial.scene, dice: [{ ...die, offsets: { "x+": 1 } }] });
    reject({ ...initial.scene, dice: [{ ...die, position: { x: NaN, y: 0, z: 0 } }] });
    reject({ ...initial.scene, trail: Array(129).fill(initial.scene.trail[0]) });
  });

  it("uses the same documents on both authoring surfaces and keeps classroom input fail-closed", async () => {
    const tools = [diceTool(), netTool(await buildNet())];
    const page = createEmptyCoursewareCompositionPage();
    page.layout.blocks = tools.map((tool, index) => ({ id: `spatial-${index}`, type: "tool", tool, placement: { column: index * 6, row: 0, columnSpan: 6, rowSpan: 9 } }));
    expect(parseCoursewareDoc(JSON.parse(JSON.stringify(page)))).toEqual(page);
    expect(formalCubePageSchema.parse(page)).toEqual(page);
    expect(formalManualPageSchema.parse(page)).toEqual(page);
    expect(collectCoursewareDocBindingKeys(page)).toBeNull();
    const audit = resolveClassroomInteractionAudit(page);
    expect(audit.provider?.mode).toBe("read-only");
    for (const tool of tools) {
      expect(spatialTeachingToolSchema.safeParse({ ...tool, draftId: "private" }).success).toBe(false);
      expect(spatialTeachingToolSchema.safeParse({ ...tool, contentVersion: "future" }).success).toBe(false);
      expect(spatialTeachingToolSchema.safeParse({ ...tool, payload: { ...tool.payload, initial: { ...tool.payload.initial, past: [] } } }).success).toBe(false);
    }
    const wrong = structuredClone(page); wrong.layout.blocks[0].placement.columnSpan = 1;
    expect(coursewareCompositionPageSchema.safeParse(wrong).success).toBe(false);
  });

  it("uses valid primary-schema content in the database save/freeze assertions", () => {
    const sql = readFileSync("supabase/tests/spatial_teaching_courseware_assertions.sql", "utf8");
    for (const name of ["dice", "net"]) {
      const match = sql.match(new RegExp(`${name} jsonb := '([^']+)';`));
      expect(match).not.toBeNull();
      expect(spatialTeachingToolSchema.safeParse(JSON.parse(match![1])).success).toBe(true);
    }
  });
});
