import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("shared courseware image element editor", () => {
  const shared = read("src/features/courseware-doc/CoursewareImageElementEditor.tsx");
  const formal = read("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx");
  const microcourse = read("src/features/teacher-microcourses/CoursewareCompositionWorkbench.tsx");

  it("uses one image inspector in formal-course and microcourse editors", () => {
    expect(shared).toContain("export function CoursewareImageElementInspector");
    expect(shared).toContain("export function isCoursewareImageElement");
    expect(formal).toContain("<CoursewareImageElementInspector");
    expect(microcourse).toContain("<CoursewareImageElementInspector");
    expect(formal).toContain("isCoursewareImageElement(selected)");
    expect(microcourse).toContain("isCoursewareImageElement(selectedNode)");
  });

  it("keeps page-local appearance and geometry in the shared inspector", () => {
    expect(shared).toContain('data-courseware-image-element-inspector');
    expect(shared).toContain('item.style.objectFit = value');
    expect(shared).toContain('onTransformChange({ [key]: value })');
    expect(shared).toContain('item.transform.opacity =');
    expect(shared).toContain('item.zIndex = Math.round(value)');
    expect(shared).toContain('item.visible = checked === true');
    expect(formal).not.toContain("replaceCoursewarePageImageAction");
    expect(shared).not.toContain('type="file"');
  });

  it("saves a draft head without mutating an immutable lecture release", () => {
    const migration = read("supabase/migrations/20260719000900_p6_courseware_tracks.sql");
    const start = migration.indexOf("create or replace function public.save_cw_track_page_draft(");
    const end = migration.indexOf("create or replace function public.publish_cw_track_release(", start);
    const draftFunction = migration.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(draftFunction).toContain("insert into public.cw_page_revisions");
    expect(draftFunction).toContain("draft_revision_id=next_id");
    expect(draftFunction).not.toContain("cw_lecture_releases");
    expect(draftFunction).not.toContain("cw_lecture_track_heads");
    expect(draftFunction).not.toContain("current_release_id");
  });
});
