import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVoxelAuthoringDiff } from "@/features/spatial-math/domain";
import { toolThumbs } from "@/features/tools/thumbs";
import { getTool, tools } from "@/features/tools/registry";
import {
  SPATIAL_LAB_ACTIVITIES,
  SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID,
  SPATIAL_LAB_CUBE_STRUCTURES_ID,
  SPATIAL_LAB_DICE_ID,
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
    expect(tools.map((tool) => tool.id)).toEqual(["fraction-line", "motion-lab", "cube-structures", "cube-net", "solid-nets", "dice", "projection", "solid-geometry", "solid-capacity", "solid-revolution", "soma-cube"]);
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
    expect(new Set(tools.map((tool) => tool.no)).size).toBe(tools.length);
    expect(toolThumbs["spatial-lab"]).toBeTruthy();
    for (const tool of tools) expect(toolThumbs[tool.id]).toBeTruthy();
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

  it("merges five branches into Cube Structures and keeps measurement and cube nets independent", () => {
    expect(SPATIAL_LAB_ACTIVITIES.map((activity) => [activity.id, activity.kind])).toEqual([
      ["spatial-lab.cube-structures.v1", "cube-structures"],
      ["spatial-lab.rectangular-prism-measurement.v1", "voxel"],
      ["spatial-lab.cube-net-fold.v1", "polyhedron-fold"],
      ["spatial-lab.dice-teaching.v1", "dice"],
    ]);
    expect(isSpatialLabVoxelPresetId(SPATIAL_LAB_CUBE_NET_FOLD_PRESET_ID)).toBe(false);
    expect(isSpatialLabVoxelPresetId(SPATIAL_LAB_CUBE_STRUCTURES_ID)).toBe(false);
    expect(isSpatialLabVoxelPresetId(SPATIAL_LAB_DICE_ID)).toBe(false);
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

  it("moves the template strip into a collapsed floating panel without reserving header space", () => {
    const source = readFileSync(resolve("src/features/tools/spatial-lab/SpatialLab.tsx"), "utf8");
    expect(source).toContain("[templatePanelOpen, setTemplatePanelOpen] = useState(false)");
    expect(source).toContain('className="absolute bottom-3 right-3 z-40" data-spatial-template-launcher');
    expect(source).toContain("<Popover open={templatePanelOpen} onOpenChange={setTemplatePanelOpen}>");
    expect(source).toContain("<PopoverTrigger asChild>");
    expect(source).toContain("data-spatial-template-panel");
    expect(source).toContain("setTemplatePanelOpen(false)");
    expect(source).toContain("收起题型模板");
    expect(source).toContain("Collapse template panel");
    expect(source).not.toContain('className="border-b border-line bg-moon/15 px-4 py-3 md:px-6"');
    expect(source).not.toContain("key={templatePanelOpen}");
  });

  it("keeps the mounted client leaf isolated from persistence and classroom transport", () => {
    const gallerySource = readFileSync(
      resolve("src/features/tools/spatial-lab/CubeNetGalleryPanel.tsx"),
      "utf8",
    );
    const source = [
      resolve("src/features/tools/spatial-lab/SpatialLab.tsx"),
      resolve("src/features/tools/spatial-lab/CubeNetFoldWorkspace.tsx"),
      resolve("src/features/tools/spatial-lab/CubeNetGalleryPanel.tsx"),
    ].map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n");

    for (const forbidden of [
      "supabase",
      "session_events",
      "coursewaredoc",
      "server action",
      "fetch(",
      "localstorage",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('data-layout-profile="standard-4x3"');
    expect(source).toContain('data-cube-net-drag-status');
    expect(source).toContain('onfoldstart={startfold}');
    expect(source).toContain('data-cube-net-gallery={cube_net_gallery_version}');
    expect(source).toContain("buildcubenetgalleryfolding");
    expect(source).toContain("data-folding-entry={build.entry.id}");
    expect(gallerySource).not.toContain("<input");
    expect(gallerySource).not.toContain("<select");
  });

  it("opens manual folding without preset answers, playback or a mounted validity quiz", () => {
    const source = readFileSync(resolve("src/features/tools/spatial-lab/CubeNetFoldWorkspace.tsx"), "utf8");
    expect(source).toContain("data-cube-net-teaching={CUBE_NET_TEACHING_VERSION}");
    expect(source).toContain("onFoldStart={startFold}");
    expect(source).not.toContain("onHingeSelect");
    expect(source).toContain("onCommit={commitFold}");
    expect(source).not.toContain("<Slider");
    expect(source).toContain("CubeStructuresWorkbench.module.css");
    expect(source).toContain("data-cube-view-toolbar");
    expect(source).toContain("data-cube-tools-toolbar");
    expect(source).toContain("<SpatialViewButtons views={CUBE_WORKBENCH_VIEWS}");
    expect(source).toContain("setJudgment(null)");
    expect(source).toContain("useState<CubeNetFoldJudgment | null>(initial?.judgment ?? null)");
    expect(source).toContain("judgeCubeNetFold(frameResolver.resolveHinges(cubeNetHingeProgress(angles)))");
    for (const oldUi of ["<CubeNetGalleryPanel", "<PolyhedronFoldTeachingStage", 't("cubeNet.legalNet")', 't("cubeNet.verifiedConclusion")']) {
      expect(source).not.toContain(oldUi);
    }
  });
});
