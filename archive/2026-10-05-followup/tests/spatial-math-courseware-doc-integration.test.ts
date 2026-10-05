import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isSpatialPageDoc,
  parseCoursewareDoc,
} from "@/features/courseware-doc/document";
import { wideSpatialPageFrom, validStandardSpatialPage } from "./fixtures/spatial-page";

const read = (path: string) => readFileSync(path, "utf8");

describe("SML-0 production CoursewareDoc integration", () => {
  it("strictly parses standard and exceptional-wide spatial pages through CoursewareDoc", async () => {
    const standard = await validStandardSpatialPage();
    const wide = wideSpatialPageFrom(standard);

    expect(parseCoursewareDoc(standard)).toEqual(standard);
    expect(parseCoursewareDoc(wide)).toEqual(wide);
    expect(isSpatialPageDoc(parseCoursewareDoc(standard))).toBe(true);
    expect(() => parseCoursewareDoc({ ...standard, docVersion: "spatial-page-v2" })).toThrow();
  });

  it("dispatches spatial documents to the shared renderer without retaining the legacy Studio route", () => {
    const preview = read("src/features/courseware-studio/StagePreview.tsx");
    const workspace = read("src/features/courseware-studio/UnifiedCoursewareWorkspace.tsx");

    expect(preview).toContain("isSpatialPageDoc(props.doc)");
    expect(preview).toContain("SpatialCoursewareStage");
    expect(preview).toContain('aspect-[4/3]');
    expect(workspace).toContain("StagePreview");
    expect(() => read("src/app/[locale]/studio/courseware/[lectureId]/page.tsx")).toThrow();
  });

  it("renders the initial deterministic spatial state with the existing WebGL and SVG fallback chain", () => {
    const stage = read("src/features/courseware-doc/SpatialCoursewareStage.tsx");

    expect(stage).toContain("createInitialSpatialRuntimeState(doc)");
    expect(stage).toContain("<VoxelView");
    expect(stage).toContain("<PolyhedronFoldView");
    expect(stage).toContain('data-layout-profile={doc.layout.profile}');
    expect(stage).not.toMatch(/fetch\(|supabase|session_events|localStorage/);
  });

  it("derives Studio and release preview aspect from layout metadata instead of the compatibility track", () => {
    const data = read("src/features/courseware-studio/data.ts");

    expect(data).toContain("draft_layout_profile,current_layout_profile");
    expect(data).toContain("aspectForLayoutProfile(head.draft_layout_profile ?? head.current_layout_profile, track)");
    expect(data).toContain("layoutByRevision.get(entry.revisionId)");
  });

  it("verifies spatial scene hashes before unified draft saves", () => {
    const actions = read("src/features/courseware-studio/actions.ts");

    expect(actions).toContain("verifySpatialDocForAction");
    expect(actions).toContain('rpc<Array<{ revision_no: number }>>(supabase, "save_cw_track_page_draft"');
    expect(actions).toContain("SPATIAL_PAGE_SCENE_HASH_MISMATCH");
    expect(actions).toContain("PAIRED_TRACKS_NOT_READY");
    expect(actions).not.toContain("publishCoursewareReleaseAction");
  });

  it("keeps paired delivery atomic across publish, review and rollback while hiding internal helpers", () => {
    const migration = read("supabase/migrations/20260813000200_sml0_spatial_delivery_lifecycle.sql");

    expect(migration).toContain("create function public.perform_cw_paired_publish");
    expect(migration).toContain("published_release_ids = jsonb_build_object");
    expect(migration).toContain("array_agg(release_value.id order by release_value.published_at desc");
    expect(migration).toContain("perform public.sync_cw_spatial_page_pointers(p_lecture_id)");
    expect(migration).toContain("raise exception 'INVALID_PAGE_TITLE'");
    expect(migration).toContain(
      "revoke all on function public.perform_cw_paired_publish(uuid, text, jsonb, uuid) from public, anon, authenticated",
    );
  });
});
