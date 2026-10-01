import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseToolScene } from "@/features/tools/scenes/contract";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { planarSnapshot, planarSnapshotForTool, planarStateSchema, type PlanarToolId, type PlanarVersion } from "@/features/tools/planar-kit/contract";
import { planarCommit, planarFrame, planarHistory } from "@/features/tools/planar-kit/presentation";
import { resolvePlanarContextActions } from "@/features/tools/planar-kit/context-actions";
import { createClassroomToolState, parseClassroomToolState, type ClassroomToolUpdate } from "@/features/tools/courseware/tool-classroom";
import { toolSceneOriginHash } from "@/features/tools/scenes/classroom-envelope";

const upgrades = [
  ["plane-perimeter", "10", "10-create"], ["plane-measurement", "11", "11-create"], ["plane-geoboard", "34", "34-create"],
  ["plane-area-relations", "18", "18-create"], ["plane-overlap", "33", "33-create"],
] as const;
describe("the next five editable plane tools keep one versioned save/classroom contract", () => {
  for (const [toolId, oldId, newId] of upgrades) it(`${toolId}: exact defaults, independent legacy version and classroom identity`, () => {
    const definition = planarScene(newId), initial = definition.create(), old = planarScene(oldId).create();
    expect(scenesForPlanarTool(toolId).map((scene) => scene.id)).toContain(newId);
    expect(scenesForPlanarTool(toolId, `${toolId}-lesson-v1`).map((scene) => scene.id)).toContain(oldId);
    const contentVersion = `${toolId}-lesson-v2` as PlanarVersion;
    const scene = parseToolScene({ toolId, contentVersion, payload: { title: "Editable material", initial } });
    const state = planarSnapshot(initial);
    const event = createClassroomToolState("page", "doc", "instance", { toolId, contentVersion, state } as ClassroomToolUpdate, toolSceneOriginHash(scene.payload));
    expect(parseClassroomToolState(JSON.parse(JSON.stringify(event)))).toEqual(event);
    expect(planarSnapshotForTool(toolId, contentVersion).safeParse(planarSnapshot(old)).success).toBe(false);
    expect(() => parseToolScene({ toolId, contentVersion: `${toolId}-lesson-v1`, payload: { title: "Historical material", initial: old } })).not.toThrow();
    for (const action of [...definition.actions ?? [], ...definition.operations?.flatMap((operation) => operation.actions ?? []) ?? []]) {
      if (action.disabled?.(initial, { selected: null })) continue;
      const endpoint = action.run(initial, { selected: null });
      expect(planarStateSchema.safeParse(endpoint).success, `${newId}/${action.id}`).toBe(true);
      const next = planarCommit(state, initial, endpoint, action.duration ? { id: action.id, duration: action.duration, now: 1000 } : undefined);
      expect(planarSnapshotForTool(toolId, contentVersion).safeParse(next).success, `${newId}/${action.id}/snapshot`).toBe(true);
      expect(planarFrame(JSON.parse(JSON.stringify(next)), definition, 100000)).toEqual(endpoint);
      if (JSON.stringify(endpoint) !== JSON.stringify(initial)) expect(planarHistory(next, "undo").current).toEqual(initial);
    }
  });
  it("matches checked SQL defaults and rejects extra state/foreign versions on both sides", () => {
    const sql = readFileSync("supabase/tests/tool_plane_deep.sql", "utf8");
    const fixtures = JSON.parse(sql.split("$fixtures$")[1]) as { toolId: PlanarToolId; contentVersion: PlanarVersion; payload: { initial: ReturnType<typeof planarScene>["create"] extends () => infer S ? S : never } }[];
    expect(fixtures).toHaveLength(5);
    for (const fixture of fixtures) {
      expect(fixture.payload.initial).toEqual(planarScene(fixture.payload.initial.sceneId).create());
      expect(parseToolScene(fixture)).toEqual(fixture);
      expect(() => parseToolScene({ ...fixture, payload: { ...fixture.payload, initial: { ...fixture.payload.initial, params: { ...fixture.payload.initial.params, extra: 1 } } } })).toThrow();
    }
    const migration = readFileSync("supabase/migrations/20261002000400_tool_plane_deep_catalog.sql", "utf8");
    expect(migration).toContain("pg_get_functiondef('public.tool_scene_is_valid(jsonb)'::regprocedure)");
    expect(migration).toContain("PLANE_DEEP_DISPATCH_PRECONDITION");
  });
  it("uses valid existing object action descriptors and works without secure-context UUIDs", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      for (const [, , sceneId] of upgrades) {
        const definition = planarScene(sceneId), initial = definition.create();
        expect(resolvePlanarContextActions(definition, initial, null)).toBeNull();
        const context = definition.contextActions?.(initial, `object.${initial.params.active}`);
        if (context) expect(resolvePlanarContextActions(definition, initial, `object.${initial.params.active}`)?.items.length).toBeGreaterThan(0);
        const replay = planarCommit(planarSnapshot(initial), initial, initial, { id: "replay", duration: 1000, now: 1000 });
        expect(replay.motion?.id).toMatch(/^[a-f0-9-]{36}$/);
      }
    } finally { vi.unstubAllGlobals(); }
  });
});
