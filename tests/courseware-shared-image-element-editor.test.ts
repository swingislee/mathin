import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("shared courseware image element editor", () => {
  const shared = read("src/features/courseware-doc/CoursewareImageElementEditor.tsx");
  const elementEditor = read("src/features/courseware-doc/CoursewarePageElementEditor.tsx");
  const textEditor = read("src/features/courseware-doc/CoursewareTextElementEditor.tsx");
  const formal = read("src/features/courseware-studio/PageDocVerticalSliceEditor.tsx");
  const microcourse = read("src/features/teacher-microcourses/CoursewareCompositionWorkbench.tsx");

  it("uses one element dispatcher rather than parallel text and image dispatch in both editors", () => {
    expect(shared).toContain("export function CoursewareImageElementInspector");
    expect(shared).toContain("export function isCoursewareImageElement");
    expect(textEditor).toContain("export function CoursewareTextElementInspector");
    expect(elementEditor).toContain("export function CoursewarePageElementInspector");
    expect(elementEditor).toContain("<CoursewareTextElementInspector");
    expect(elementEditor).toContain("<CoursewareImageElementInspector");
    expect(formal).toContain("<CoursewarePageElementInspector");
    expect(microcourse).toContain("<CoursewarePageElementInspector");
    expect(formal).not.toContain("<CoursewareTextElementInspector");
    expect(formal).not.toContain("<CoursewareImageElementInspector");
    expect(microcourse).not.toContain("<CoursewareTextElementInspector");
    expect(microcourse).not.toContain("<CoursewareImageElementInspector");
  });

  it("keeps image-specific fit and geometry in the image inspector", () => {
    expect(shared).toContain('data-courseware-image-element-inspector');
    expect(shared).toContain('item.style.objectFit = value');
    expect(shared).toContain('onTransformChange({ [key]: value })');
    expect(shared).not.toContain('item.zIndex = Math.round(value)');
    expect(shared).not.toContain('item.visible = checked === true');
    expect(formal).not.toContain("replaceCoursewarePageImageAction");
    expect(shared).not.toContain('type="file"');
  });

  it("owns layers and common appearance once for every page element type", () => {
    expect(elementEditor).toContain("export function CoursewareLayerPanel");
    expect(elementEditor).toContain("data-courseware-layer-panel");
    expect(elementEditor).toContain('aria-expanded={expanded}');
    expect(elementEditor).toContain('role="listbox"');
    expect(elementEditor).toContain('role="option"');
    expect(elementEditor).toContain("ordered.map((item)");
    expect(elementEditor).toContain("onLayerChange(item.id, item.layer + 1)");
    expect(elementEditor).toContain("onLayerChange(item.id, item.layer - 1)");
    expect(elementEditor).toContain("item.zIndex = Math.round(value)");
    expect(elementEditor).toContain("item.visible = checked === true");
    expect(elementEditor).toContain("item.transform.opacity =");
    expect(formal).toContain("items={layerItems}");
    expect(formal).toContain("collectLayerItems(node.children, depth + 1)");
    expect(microcourse).toContain("doc.layout.blocks.map((block, index)");
    expect(microcourse).not.toContain('className="grid grid-cols-2 gap-1"');
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
