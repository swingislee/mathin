import { describe, expect, it } from "vitest";
import { PLANAR_TOOLS, planarSnapshot, planarSnapshotForTool } from "@/features/tools/planar-kit/contract";
import { planarScene, scenesForPlanarTool } from "@/features/tools/planar-kit/scene-registry";
import { parseToolScene, freezeToolScene } from "@/features/tools/scenes/contract";
import { toolCoursewareContractsForSurface } from "@/features/tools/scenes/registry";
import { planeRoutesCases } from "./fixtures/plane-routes-cases";
import { planeRouteScenes } from "@/features/tools/plane-route-workbench/scenes";

describe("independent route versions after shared registration", () => {
  it("offers v2 for new insertions and keeps v1 readable but version-isolated", () => {
    for (const definition of planeRouteScenes) {
      const current = PLANAR_TOOLS.find((tool) => tool.id === definition.toolId)!;
      expect(current.version).toBe(`${definition.toolId}-lesson-v2`);
      expect(planarScene(definition.id).create()).toEqual(definition.create());
      for (const surface of ["microcourse", "formal-courseware"] as const) expect(toolCoursewareContractsForSurface(surface).filter((entry) => entry.catalogId === definition.toolId).map((entry) => entry.contentVersion)).toEqual([current.version]);
      const legacyVersion = `${definition.toolId}-lesson-v1` as Parameters<typeof scenesForPlanarTool>[1];
      const legacy = scenesForPlanarTool(definition.toolId, legacyVersion)[0].create();
      expect(() => parseToolScene({ toolId: definition.toolId, contentVersion: legacyVersion, payload: { title: "Legacy", initial: legacy } })).not.toThrow();
      expect(() => parseToolScene({ toolId: definition.toolId, contentVersion: current.version, payload: { title: "Wrong version", initial: legacy } })).toThrow();
      expect(planarSnapshotForTool(definition.toolId, current.version).safeParse({ ...planarSnapshot(definition.create()), past: [legacy] }).success).toBe(false);
    }
  });
  it("validates every shared TS/SQL fixture and freezes detached exact material state", () => {
    for (const entry of planeRoutesCases()) {
      if (!entry.accepted) { expect(() => parseToolScene(entry.scene), entry.label).toThrow(); continue; }
      const scene = parseToolScene(entry.scene), frozen = freezeToolScene(scene), saved = JSON.stringify(frozen);
      expect(frozen).toEqual(scene); entry.scene.payload.initial.phase = 0.17;
      expect(JSON.stringify(frozen), entry.label).toBe(saved);
    }
  });
});
