import { describe, expect, it } from "vitest";
import { coursewareDocSchema } from "@/features/courseware-doc/document";
import {
  SPATIAL_PAGE_DOC_VERSION,
  SPATIAL_PAGE_ERROR_CODES,
  canonicalSha256,
  materializeSpatialPageDoc,
  spatialPageDocSchema,
  verifySpatialPageDoc,
  verifySpatialPageLayoutSet,
  type SpatialPageDoc,
} from "@/features/spatial-math/domain";
import {
  standardSpatialPageDraft,
  validStandardSpatialPage,
  wideSpatialPageFrom,
} from "./fixtures/spatial-page";

describe("spatial-page-v1 structure", () => {
  it("materializes and verifies a strict page without enabling the production CoursewareDoc union", async () => {
    const page = await validStandardSpatialPage();

    expect(page.docVersion).toBe(SPATIAL_PAGE_DOC_VERSION);
    expect(page.sceneHash).toBe(await canonicalSha256(page.scene));
    await expect(verifySpatialPageDoc(page)).resolves.toEqual(page);
    expect(coursewareDocSchema.safeParse(page).success).toBe(false);
  });

  it("rejects unknown fields, a wrong layout ratio, an unknown camera and a non-label placement", async () => {
    const page = await validStandardSpatialPage();
    const unknown = { ...page, executable: "alert(1)" };
    const ratio = structuredClone(page);
    ratio.presentation.viewport.width = 1_600;
    const camera = structuredClone(page);
    camera.presentation.camera.defaultCameraId = "camera.missing";
    const label = structuredClone(page);
    label.presentation.labelPlacements[0].entityId = "voxel.main";

    expect(spatialPageDocSchema.safeParse(unknown).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(ratio).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(camera).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(label).success).toBe(false);
  });

  it("keeps ownership, learning checks and fallback coverage consistent", async () => {
    const page = await validStandardSpatialPage();
    const defaultMode = structuredClone(page);
    defaultMode.classroom.ownership.allowedModes = ["student-local-explore", "student-submit"];
    const disabled = structuredClone(page) as SpatialPageDoc;
    disabled.learningCheck = { mode: "disabled" };
    const explanation = structuredClone(page);
    if (explanation.learningCheck.mode !== "formative-only") throw new Error("fixture learning check mismatch");
    explanation.learningCheck.items[1].evaluation = "server-pinned-kernel";
    const fallback = structuredClone(page);
    fallback.fallback.checkpoints.pop();

    expect(spatialPageDocSchema.safeParse(defaultMode).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(disabled).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(explanation).success).toBe(false);
    expect(spatialPageDocSchema.safeParse(fallback).success).toBe(false);
  });

  it("requires page source metadata to match scene provenance", async () => {
    const page = await validStandardSpatialPage();
    const sourceMismatch = structuredClone(page);
    sourceMismatch.source = {
      kind: "preset-release",
      presetId: "preset.layer-count",
      releaseNo: 1,
      sourceSceneHash: "a".repeat(64),
    };

    expect(spatialPageDocSchema.safeParse(sourceMismatch).success).toBe(false);
  });

  it("detects a structurally valid but forged scene hash", async () => {
    const page = await validStandardSpatialPage();
    const forged = { ...page, sceneHash: "0".repeat(64) };

    expect(spatialPageDocSchema.safeParse(forged).success).toBe(true);
    await expect(verifySpatialPageDoc(forged)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.sceneHashMismatch,
    });
  });
});

describe("spatial-page-v1 4:3-first layout set", () => {
  it("accepts a standard 4:3 page without requiring a second authored layout", async () => {
    const standard = await validStandardSpatialPage();

    await expect(verifySpatialPageLayoutSet(standard)).resolves.toEqual({ standard });
  });

  it("allows an explicitly justified wide exception to differ only in presentation", async () => {
    const standard = await validStandardSpatialPage();
    const wide = wideSpatialPageFrom(standard);

    await expect(verifySpatialPageLayoutSet(standard, wide)).resolves.toEqual({ standard, wide });
  });

  it("rejects a missing wide-screen exception reason", async () => {
    const standard = await validStandardSpatialPage();
    const wideWithoutReason = {
      ...wideSpatialPageFrom(standard),
      layout: { profile: "wide-16x9-exception" },
    };

    expect(spatialPageDocSchema.safeParse(wideWithoutReason).success).toBe(false);
  });

  it("rejects duplicate/reversed layout profiles with a stable error code", async () => {
    const standard = await validStandardSpatialPage();

    await expect(verifySpatialPageLayoutSet(standard, standard)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetOrder,
    });
  });

  it("rejects semantic policy or scene drift between layout variants", async () => {
    const standard = await validStandardSpatialPage();
    const policyDrift = wideSpatialPageFrom(standard);
    policyDrift.classroom.cameraSync = "bookmark-only";

    const changedScene = structuredClone(standard.scene);
    changedScene.title.zh = "另一份场景";
    const sceneDrift = await materializeSpatialPageDoc({
      ...standardSpatialPageDraft(changedScene),
      layout: wideSpatialPageFrom(standard).layout,
      presentation: wideSpatialPageFrom(standard).presentation,
    });

    await expect(verifySpatialPageLayoutSet(standard, policyDrift)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetMismatch,
    });
    await expect(verifySpatialPageLayoutSet(standard, sceneDrift)).rejects.toMatchObject({
      code: SPATIAL_PAGE_ERROR_CODES.layoutSetMismatch,
    });
  });
});
