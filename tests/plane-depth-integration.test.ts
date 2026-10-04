import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ALL_PLANAR_TOOLS, PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool } from "@/features/tools/planar-kit/contract";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { planarCommit, planarFrame, planarHistory } from "@/features/tools/planar-kit/presentation";
import { freezeToolScene, parseToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";
import { planeOverlapConcaveCases } from "./fixtures/plane-overlap-concave-cases";
import { planeCellCoverageCases } from "./fixtures/plane-cell-coverage-cases";

const upgrades = [
  { id: "plane-overlap", version: "plane-overlap-lesson-v3", scene: "33-concave" },
  { id: "plane-area-relations", version: "plane-area-relations-lesson-v5", scene: "18-coverage" },
] as const;

describe("parallel planar deepening uses isolated versioned content", () => {
  for (const tool of upgrades) it(`${tool.id}: only the new version is offered while all previous copies remain readable`, () => {
    expect(PLANAR_TOOLS.find((entry) => entry.id === tool.id)?.version).toBe(tool.version);
    expect(scenesForPlanarTool(tool.id).map((scene) => scene.id)).toEqual([tool.scene]);
    const initial = planarScene(tool.scene).create();
    for (const surface of ["microcourse", "formal-courseware"] as const) {
      expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === tool.id).map((entry) => entry.contentVersion)).toEqual([tool.version]);
    }
    for (const legacy of ALL_PLANAR_TOOLS.filter((entry) => entry.id === tool.id && entry.version !== tool.version)) {
      for (const scene of scenesForPlanarTool(legacy.id, legacy.version)) {
        const old = scene.create();
        expect(() => parseToolScene({ toolId: tool.id, contentVersion: legacy.version, payload: { title: "Previous prepared scene", initial: old } })).not.toThrow();
        expect(() => parseToolScene({ toolId: tool.id, contentVersion: tool.version, payload: { title: "Wrong current version", initial: old } })).toThrow();
        expect(() => parseToolScene({ toolId: tool.id, contentVersion: legacy.version, payload: { title: "Wrong previous version", initial } })).toThrow();
        expect(planarSnapshotForTool(tool.id, tool.version).safeParse({ ...planarSnapshot(initial), past: [old] }).success).toBe(false);
        expect(planarSnapshotForTool(legacy.id, legacy.version).safeParse(planarSnapshot(initial)).success).toBe(false);
      }
    }
  });

  for (const [label, fixtures] of [["concave regions", planeOverlapConcaveCases], ["inner and outer cells", planeCellCoverageCases]] as const) {
    it(`${label}: uses the same strict fixtures for TS parsing and transactional SQL verification`, () => {
      const cases = fixtures();
      expect(cases.some((entry) => entry.accepted && entry.label === "visible")).toBe(true);
      expect(cases.some((entry) => !entry.accepted)).toBe(true);
      for (const entry of cases) {
        if (!entry.accepted) { expect(() => parseToolScene(entry.scene), entry.label).toThrow(); continue; }
        const parsed = parseToolScene(entry.scene), frozen = freezeToolScene(parsed), saved = JSON.stringify(frozen);
        expect(parseToolScene(JSON.parse(saved))).toEqual(frozen);
        const copy = structuredClone(entry.scene); copy.payload.initial.points.localOnly = { x: 1, y: 1 };
        expect(JSON.stringify(frozen)).toBe(saved);
        expect(() => parseToolScene(copy), entry.label).toThrow();
      }
    });
  }

  for (const tool of upgrades) it(`${tool.id}: shares exact history and classroom endpoints without a secure-context UUID API`, () => {
    const definition = planarScene(tool.scene), initial = definition.create();
    const prepared = freezeToolScene(parseToolScene({ toolId: tool.id, contentVersion: tool.version, payload: { title: "Prepared geometry", initial } }));
    const original = JSON.stringify(prepared);
    const action = definition.actions!.find((entry) => !entry.disabled?.(initial, { selected: `object.${initial.params.active}` })
      && JSON.stringify(entry.run(initial, { selected: `object.${initial.params.active}` })) !== JSON.stringify(initial))!;
    expect(action).toBeDefined();
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const endpoint = action.run(initial, { selected: `object.${initial.params.active}` });
      const snapshot = planarCommit(planarSnapshot(initial), initial, endpoint, action.duration ? { id: action.id, duration: action.duration, now: 100 } : undefined);
      expect(planarSnapshotForTool(tool.id, tool.version).safeParse(snapshot).success).toBe(true);
      expect(snapshot.past).toEqual([initial]); expect(planarHistory(snapshot, "undo").current).toEqual(initial);
      const update = { toolId: tool.id, contentVersion: tool.version, state: snapshot } as ClassroomToolUpdate;
      const event = createClassroomToolState("page", "doc", "instance", update, toolSceneOriginHash(prepared.payload));
      expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
      expect(planarFrame(JSON.parse(JSON.stringify(snapshot)), definition, 10_000)).toEqual(endpoint);
      const wrong = planarScene(tool.id === "plane-overlap" ? "33-create" : "18-strips").create();
      expect(parseClassroomToolState({ ...event, state: { ...snapshot, current: wrong } })).toBeNull();
    } finally { vi.unstubAllGlobals(); }
    expect(JSON.stringify(prepared)).toBe(original);
  });

  it("adds only strict helper dispatch and leaves the saved-scene API and access policies intact", () => {
    const migration = readFileSync("supabase/migrations/20261004020200_tool_plane_depth_catalog.sql", "utf8");
    for (const helper of ["tool_plane_overlap_concave_scene_is_valid", "tool_plane_cell_coverage_scene_is_valid"]) expect(migration).toContain(`or public.${helper}(p_scene)`);
    for (const tool of upgrades) expect(migration).toContain(`when ''${tool.version}'' then ''${tool.id}''`);
    expect(migration).toContain("PLANE_DEPTH_DISPATCH_PRECONDITION");
    expect(migration).toContain("PLANE_DEPTH_CATALOG_PRECONDITION");
    expect(migration).not.toMatch(/\b(?:delete\s+from|update\s+public\.|alter\s+table|create\s+policy|save_tool_scene_draft)\b/i);
  });
});
