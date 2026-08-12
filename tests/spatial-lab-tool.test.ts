import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVoxelAuthoringDiff } from "@/features/spatial-math/domain";
import { toolThumbs } from "@/features/tools/thumbs";
import { getTool, tools } from "@/features/tools/registry";
import {
  SPATIAL_LAB_ACTIVITIES,
  SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID,
  SPATIAL_LAB_PRESET_ID,
  SPATIAL_LAB_PRESETS,
  createSpatialLabInitialDraft,
  createSpatialLabPresetDraft,
  isSpatialLabVoxelPresetId,
} from "@/features/tools/spatial-lab/preset";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    leafKeys(nested, prefix ? `${prefix}.${key}` : key),
  );
}

describe("spatial-lab Tools acceptance prototype", () => {
  it("registers a stable geometry tool without changing the generic Tools route contract", () => {
    expect(getTool("spatial-lab")).toMatchObject({
      id: "spatial-lab",
      no: 3,
      category: "geometry",
      grades: [1, 9],
    });
    expect(tools.map((tool) => tool.id)).toContain("spatial-lab");
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    expect(new Set(tools.map((tool) => tool.no)).size).toBe(tools.length);
    expect(toolThumbs["spatial-lab"]).toBeTruthy();
  });

  it("builds the fixed bilingual voxel preset as one 1200 by 900 4:3 page", async () => {
    const draft = createSpatialLabInitialDraft();
    const result = await buildVoxelAuthoringDiff(draft, draft);
    const page = result.afterPreview.build.page;

    expect(SPATIAL_LAB_PRESET_ID).toBe("spatial-lab.voxel-counting.v1");
    expect(draft.model).toMatchObject({
      sceneId: "scene.spatial-lab.voxel-counting",
      entityId: "voxel.main",
      layerAxis: "y",
      title: { zh: "分层数单位正方体", en: "Count unit cubes by layer" },
    });
    expect(draft.model.cells).toHaveLength(10);
    expect(page.layout).toEqual({ profile: "standard-4x3" });
    expect(page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(result.diff.before).toEqual(result.diff.after);
    expect(result.diff.derived).toEqual({});
  });

  it("offers deterministic 4:3 templates for counting, views, painting, hollowing, and measurement", async () => {
    const expectedCounts = [10, 14, 12, 27, 27, 24];
    const builds = await Promise.all(
      SPATIAL_LAB_PRESETS.map(async (preset, index) => {
        const first = createSpatialLabPresetDraft(preset.id);
        const second = createSpatialLabPresetDraft(preset.id);
        const result = await buildVoxelAuthoringDiff(first, second);
        expect(first).toEqual(second);
        expect(first.model.cells).toHaveLength(expectedCounts[index]);
        expect(result.afterPreview.build.page.layout).toEqual({ profile: "standard-4x3" });
        expect(result.afterPreview.build.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
        expect(result.diff.before).toEqual(result.diff.after);
        return result.diff.after.draftHash;
      }),
    );

    expect(SPATIAL_LAB_PRESETS.map((preset) => preset.id)).toEqual([
      "spatial-lab.voxel-counting.v1",
      "spatial-lab.hidden-cubes.v1",
      "spatial-lab.three-views.v1",
      "spatial-lab.surface-paint.v1",
      "spatial-lab.hollowing.v1",
      "spatial-lab.rectangular-prism-measurement.v1",
    ]);
    expect(new Set(builds).size).toBe(6);
  });

  it("routes the seventh cube-net activity away from the voxel draft factory", () => {
    expect(SPATIAL_LAB_ACTIVITIES.map((activity) => [activity.id, activity.kind])).toEqual([
      ["spatial-lab.voxel-counting.v1", "voxel"],
      ["spatial-lab.hidden-cubes.v1", "voxel"],
      ["spatial-lab.three-views.v1", "voxel"],
      ["spatial-lab.surface-paint.v1", "voxel"],
      ["spatial-lab.hollowing.v1", "voxel"],
      ["spatial-lab.rectangular-prism-measurement.v1", "voxel"],
      ["spatial-lab.cube-net-fold.v1", "polyhedron-fold"],
    ]);
    expect(isSpatialLabVoxelPresetId(SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID)).toBe(false);
    expect(() =>
      (createSpatialLabPresetDraft as (value: string) => unknown)(SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID),
    ).toThrow(/unknown spatial-lab voxel preset/);
  });

  it("keeps the prototype bilingual and exposes the same message surface in zh and en", () => {
    const zh = JSON.parse(readFileSync(resolve("messages/zh.json"), "utf8"));
    const en = JSON.parse(readFileSync(resolve("messages/en.json"), "utf8"));

    expect(zh.tools.items["spatial-lab"]).toBeTruthy();
    expect(en.tools.items["spatial-lab"]).toBeTruthy();
    expect(leafKeys(zh.tools.spatialLab).sort()).toEqual(leafKeys(en.tools.spatialLab).sort());
  });

  it("keeps the mounted client leaf isolated from persistence and classroom transport", () => {
    const source = [
      resolve("src/features/tools/spatial-lab/SpatialLab.tsx"),
      resolve("src/features/tools/spatial-lab/CubeNetFoldWorkspace.tsx"),
    ].map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n");

    for (const forbidden of [
      "supabase",
      "session_events",
      "coursewaredoc",
      "server action",
      "fetch(",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('data-layout-profile="standard-4x3"');
    expect(source).toContain('controlslayout="external"');
  });
});
