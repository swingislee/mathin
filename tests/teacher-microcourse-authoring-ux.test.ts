import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("teacher microcourse authoring UX", () => {
  it("selects published lectures and inserts the complete release in one transaction", () => {
    const picker = read("src", "features", "teacher-microcourses", "MicrocourseSourcePicker.tsx");
    const actions = read("src", "features", "teacher-microcourses", "actions.ts");
    const courseActions = read("src", "features", "school", "actions", "classes.ts");
    const sharedPicker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const catalogPickerMigration = read("supabase", "migrations", "20260827000600_teacher_microcourse_course_catalog_picker.sql");
    const catalogAccessMigration = read("supabase", "migrations", "20260827000700_teacher_microcourse_course_catalog_access.sql");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(picker).toContain("aria-pressed={checked}");
    expect(picker).toContain("<CoursePicker");
    expect(picker).toContain('fixedCourseKind="curriculum"');
    expect(picker).toContain('purpose="production"');
    expect(picker).toContain('accessContext="microcourse-source"');
    expect(picker).not.toContain("StagePreview");
    expect(picker).not.toContain("previewDoc");
    expect(picker).toContain("createTeacherCompositionPagesFromLectureAction");
    expect(picker).toContain("source.pageCount");
    expect(picker).not.toContain("for (const revisionId");
    expect(actions).toContain('"create_teacher_microcourse_composition_pages_from_lecture"');
    expect(actions).toContain("listTeacherMicrocourseSourceLectures");
    expect(catalogPickerMigration).toContain("list_teacher_microcourse_source_lectures");
    expect(catalogPickerMigration).toContain("copy_teacher_microcourse_lecture_pages_internal");
    expect(catalogPickerMigration).toContain("from public, anon, authenticated");
    expect(catalogPickerMigration).not.toContain("preview_doc");
    expect(sharedPicker).toContain("searchTeacherMicrocourseSourceCoursesAction");
    expect(courseActions).toContain('"courseware.microcourse.author"');
    expect(catalogAccessMigration).toContain("p_purpose = 'production'");
    expect(catalogAccessMigration).toContain("p_course_kind = 'curriculum'");
    expect(catalogAccessMigration).toContain("can_build_class or course_row.course_kind = 'curriculum'");
    expect(picker).toContain("retrySourceSearch");
    expect(zh).toContain('"insertLecture"');
    expect(en).toContain('"insertLecture"');
    expect(zh).toContain('"sourceCourseLabel"');
    expect(en).toContain('"sourceCourseLabel"');
  });

  it("keeps details compact and autosaves composition pages before navigation", () => {
    const editor = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const workbench = read("src", "features", "teacher-microcourses", "CoursewareCompositionWorkbench.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(editor).toContain("const [detailsOpen, setDetailsOpen] = useState(false)");
    expect(editor).toContain("aria-expanded={detailsOpen}");
    expect(workbench).toContain("useImperativeHandle(ref, () => ({ flush, rename })");
    expect(editor).toContain("await persistCurrentPage()");
    expect(workbench).toContain("window.setTimeout(() => void flushRef.current(), 800)");
    expect(workbench).toContain("saveTeacherMicrocoursePageAction");
    expect(editor).toContain("createTeacherCompositionPageAction");
    expect(editor).toContain("CoursewareCompositionWorkbench");
    expect(editor).toContain('data-teacher-microcourse-editor="composition"');
    expect(workbench).toContain('data-testid="microcourse-autosave-status"');
    expect(zh).toContain('"pageAutosaving"');
    expect(en).toContain('"pageAutosaving"');
  });
});
