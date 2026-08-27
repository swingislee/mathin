import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");
const lifecycleMigration = read("supabase", "migrations", "20260826000400_teacher_microcourse_lifecycle.sql");
const readModelsMigration = read("supabase", "migrations", "20260826000500_teacher_microcourse_ui_read_models.sql");
const runtimeFixesMigration = read("supabase", "migrations", "20260826000600_teacher_microcourse_runtime_fixes.sql");
const lectureSourceMigration = read("supabase", "migrations", "20260827000100_teacher_microcourse_lecture_source_picker.sql");

describe("DEV-TMC-1 teacher microcourse product surfaces", () => {
  it("keeps authoring behind the development flag, author capability, and a free session", () => {
    const sessionWorkspace = read("src", "features", "school", "SessionWorkspaceBody.tsx");
    const route = read("src", "app", "[locale]", "dashboard", "sessions", "[sessionId]", "microcourse", "page.tsx");

    expect(sessionWorkspace).toContain('isFeatureEnabled("teaching.teacher_microcourses_v1")');
    expect(sessionWorkspace).toContain('has("courseware.microcourse.author")');
    expect(sessionWorkspace).toContain("detail.lectureId === null");
    expect(route).toContain('requirePerm(locale, "courseware.microcourse.author")');
    expect(route).toContain("session.lectureId !== null");
    expect(route).toContain("!summary && !session.capabilities.canPrepare");
    expect(route).toContain("<Suspense");
  });

  it("exposes all three page modes while preserving a locked source snapshot and editable overlay", () => {
    const editor = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const picker = read("src", "features", "teacher-microcourses", "MicrocourseSourcePicker.tsx");
    const liveShell = read("src", "features", "classroom", "live", "LiveShell.tsx");
    const contentMigration = read("supabase", "migrations", "20260826000300_teacher_microcourse_content.sql");

    expect(editor).toContain("createTeacherCompositionPageAction");
    expect(editor).toContain("createTeacherSudokuPageAction");
    expect(editor).toContain("createTeacherH5PageAction");
    expect(editor).toContain("uploadTeacherMicrocourseImageAction");
    expect(picker).toContain("createTeacherCompositionPagesFromLectureAction");
    expect(picker).toContain("sourceReleaseId: selected.releaseId");
    expect(picker).toContain("sourceLectureId: selected.lectureId");
    expect(contentMigration).toContain("source_release_id");
    expect(contentMigration).toContain("source_revision_id");
    expect(contentMigration).toContain("course_row.course_kind = 'curriculum'");
    expect(readModelsMigration).toContain("coalesce(track_head.current_release_id, lecture_row.current_release_id)");
    expect(lectureSourceMigration).toContain("search_teacher_microcourse_source_lectures");
    expect(lectureSourceMigration).toContain("create_teacher_microcourse_composition_pages_from_lecture");
    expect(lectureSourceMigration).toContain("order by source_item.position");
    expect(runtimeFixesMigration).toContain("'type', 'doc'");
    expect(liveShell).toContain("session.lectureId || docPageKey");
  });

  it("keeps intermediate-review H5 private and only promotes the final frozen snapshot", () => {
    const actions = read("src", "features", "teacher-microcourses", "actions.ts");
    const review = read("src", "features", "teacher-microcourses", "MicrocourseReviewPanel.tsx");

    expect(readModelsMigration).toContain("'finalApproval', cycle_row.review_round_no >= coalesce(required_rounds, 1)");
    expect(actions).toContain("plan.finalApproval ? plan.artifacts : []");
    expect(actions).toContain("cw-h5-drafts");
    expect(actions).toContain("cw-h5");
    expect(actions).toContain('contentType: "text/html"');
    expect(actions).not.toContain('contentType: "text/html; charset=utf-8"');
    expect(review).toContain('t("immutableSnapshotHint")');
    expect(lifecycleMigration).toContain("teacher_microcourse_review_snapshots");
    expect(lifecycleMigration).toContain("snapshot_row.h5_hashes");
  });

  it("searches only eligible catalog entries and keeps a microcourse to one released lecture", () => {
    const actions = read("src", "features", "school", "actions", "classes.ts");
    const picker = read("src", "features", "school", "teaching-operations", "CoursePicker.tsx");
    const types = read("src", "features", "school", "teaching-operations", "course-picker-types.ts");

    for (const argument of ["p_course_kind", "p_author_id", "p_primary_topic_slug", "p_keyword"]) {
      expect(actions).toContain(argument);
    }
    expect(actions).toContain("listClassBuildMicrocourseTopicsAction");
    expect(picker).toContain("listClassBuildMicrocourseTopicsAction");
    expect(types).toContain("courseSeason: number | null");
    expect(lifecycleMigration).toContain("microcourse_row.published_metadata_revision_id is not null");
    expect(lifecycleMigration).toContain("microcourse_row.withdrawn_at is null");
    expect(lifecycleMigration).toContain("counts.lecture_count = 1");
    expect(lifecycleMigration).toContain("counts.released_lecture_count = 1");
  });

  it("maintains matching Chinese and English teacher-microcourse UI keys", () => {
    const zh = JSON.parse(read("messages", "zh.json")) as { teacherMicrocourses: Record<string, unknown> };
    const en = JSON.parse(read("messages", "en.json")) as { teacherMicrocourses: Record<string, unknown> };
    expect(Object.keys(zh.teacherMicrocourses).sort()).toEqual(Object.keys(en.teacherMicrocourses).sort());
  });
});
