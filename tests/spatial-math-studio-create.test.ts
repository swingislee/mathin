import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifySpatialPageDoc } from "@/features/spatial-math/domain";
import {
  SPATIAL_COURSEWARE_TEMPLATE_ID,
} from "@/features/spatial-math/presets/courseware-template-contract";
import { buildSpatialCoursewareTemplatePage } from "@/features/spatial-math/presets/courseware-template";

const read = (path: string) => readFileSync(path, "utf8");

describe("SML-0 Studio spatial page creation", () => {
  it("materializes the trusted layered-counting template as one deterministic native 4:3 page", async () => {
    const first = await buildSpatialCoursewareTemplatePage(SPATIAL_COURSEWARE_TEMPLATE_ID);
    const second = await buildSpatialCoursewareTemplatePage(SPATIAL_COURSEWARE_TEMPLATE_ID);

    expect(first).toEqual(second);
    await expect(verifySpatialPageDoc(first.page)).resolves.toEqual(first.page);
    expect(first.page.layout).toEqual({ profile: "standard-4x3" });
    expect(first.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(first.page.source).toEqual({
      kind: "preset-release",
      presetId: SPATIAL_COURSEWARE_TEMPLATE_ID,
      releaseNo: 1,
      sourceSceneHash: first.sceneHash,
    });
    expect(first.page.scene.provenance.source).toEqual({
      kind: "preset",
      sourceId: SPATIAL_COURSEWARE_TEMPLATE_ID,
      releaseNo: 1,
    });
    expect(first.sceneHash).toBe("73a789fcfb57a204b7f32c38eb59b721193efd676815b746fd6a805a3f818a97");
    expect(first.pageHash).toBe("da51fb5cc3baa07a71d9496150431ca1a8a65d3fb94ef613a96066203161d06d");
  });

  it("rejects unknown client-selected template ids before building a document", async () => {
    await expect(buildSpatialCoursewareTemplatePage("spatial-lab.future-template.v9")).rejects.toThrow(
      /unknown spatial courseware template/,
    );
  });

  it("keeps the production template independent from the public Tools prototype", () => {
    const builder = read("src/features/spatial-math/presets/courseware-template.ts");
    expect(builder).not.toContain("@/features/tools");
    expect(builder).toContain('createdBy: "mathin.courseware-template"');
  });

  it("retires the old Studio-specific insertion surface", () => {
    for (const file of [
      "src/app/[locale]/studio/courseware/[lectureId]/page.tsx",
      "src/features/courseware-studio/CoursewarePageCreateDialog.tsx",
      "src/features/courseware-studio/SpatialStudioViewer.tsx",
    ]) {
      expect(existsSync(file)).toBe(false);
    }
  });
});
