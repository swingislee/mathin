import { readFileSync } from "node:fs";
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

  it("builds the document inside a server action instead of accepting arbitrary page JSON from the dialog", () => {
    const actions = read("src/features/courseware-studio/actions.ts");
    const dialog = read("src/features/courseware-studio/CoursewarePageCreateDialog.tsx");

    expect(actions).toContain("createSpatialCoursewareTemplatePageAction");
    expect(actions).toContain("buildSpatialCoursewareTemplatePage(value.templateId)");
    expect(actions).toContain('rpc<string>(supabase, "create_cw_spatial_page"');
    expect(dialog).toContain("createSpatialCoursewareTemplatePageAction");
    expect(dialog).not.toContain("spatialPageDocSchema");
    expect(dialog).not.toMatch(/<input|<select|fetch\(|supabase/);
    expect(actions).toContain('"RESPONSIBILITY_REQUIRED"');
  });

  it("exposes insertion from empty, legacy, imported and spatial Studio states", () => {
    const route = read("src/app/[locale]/studio/courseware/[lectureId]/page.tsx");
    const legacyEditor = read("src/features/courseware-studio/CoursewarePageEditor.tsx");
    const importedViewer = read("src/features/courseware-studio/AixuexiStudioViewer.tsx");
    const spatialViewer = read("src/features/courseware-studio/SpatialStudioViewer.tsx");
    const deleteButton = read("src/features/courseware-studio/CoursewarePageDeleteButton.tsx");

    for (const source of [route, legacyEditor, importedViewer, spatialViewer]) {
      expect(source).toContain("CoursewarePageCreateDialog");
    }
    expect(spatialViewer).toContain("CoursewarePageOrderControls");
    expect(spatialViewer).toContain("CoursewarePageDeleteButton");
    expect(deleteButton).toContain('const destinationTrack = nextPageId ? track : "native-16x9"');
  });
});
