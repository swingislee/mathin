import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260813000100_sml0_release_courseware_authority.sql",
), "utf8");
const assertions = fs.readFileSync(path.join(
  root,
  "supabase/tests/sml0_release_courseware_authority_assertions.sql",
), "utf8");
const substituteMembershipMigration = fs.readFileSync(path.join(
  root,
  "supabase/migrations/20260813000400_sml0_substitute_session_membership.sql",
), "utf8");
const classroomActions = fs.readFileSync(path.join(
  root,
  "src/features/classroom/actions.ts",
), "utf8");
const preparationActions = fs.readFileSync(path.join(
  root,
  "src/features/school/actions/classes.ts",
), "utf8");
const preparationPanel = fs.readFileSync(path.join(
  root,
  "src/features/school/SessionPrepPanel.tsx",
), "utf8");
const livePage = fs.readFileSync(path.join(
  root,
  "src/app/[locale]/classroom/[classId]/session/[sessionId]/live/page.tsx",
), "utf8");

describe("SML-0 release-backed courseware authority", () => {
  it("freezes an immutable CoursewarePage projection beside every release snapshot", () => {
    expect(migration).toContain("add column courseware_pages jsonb");
    expect(migration).toContain("build_cw_release_courseware_pages");
    expect(migration).toContain("with ordinality entry(value, ordinal)");
    expect(migration).toContain("cw_lecture_releases_fill_courseware_pages");
    expect(migration).toContain("alter column courseware_pages set not null");
  });

  it("uses snapshot order and verifies each pinned revision belongs to its stable page", () => {
    const builder = migration.match(
      /create function public\.build_cw_release_courseware_pages[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(builder).toBeDefined();
    expect(builder).toContain("order by entry.ordinal");
    expect(builder).toContain("revision.page_doc_id = page.id");
    expect(builder).toContain("page.lecture_id = p_lecture_id");
    expect(builder).toContain("count(distinct entry.value ->> 'pageDocId')");
  });

  it("keeps the legacy template as an atomic native-release compatibility projection", () => {
    expect(migration).toContain("course_lectures_sync_release_projection");
    expect(migration).toContain("new.courseware_template := projection");
    expect(migration).toContain("release.track = 'native-16x9'");
    expect(migration).toContain("RELEASE_TEMPLATE_PROJECTION_READ_ONLY");
    expect(migration).toContain("set courseware_pages = source_courseware");
    expect(migration).toContain("return public.rollback_cw_track_release(");
  });

  it("separates selected-head preparation from frozen release replay", () => {
    expect(migration).toContain("resolve_cw_session_release_context");
    expect(migration).toContain("cw_session_courseware_template");
    expect(migration).toContain("cw_session_selected_courseware_template");
    expect(migration).toContain("session_row.courseware_resolved ->> 'releaseId'");
    expect(migration).toContain("coalesce(session.courseware_track_override, classroom.courseware_track)");
  });

  it("makes the public session template resolver member-scoped and keeps helpers private", () => {
    expect(migration).toContain("not public.is_session_member(p_session_id, uid)");
    expect(migration).toContain("grant execute on function public.get_session_courseware_template(uuid) to authenticated");
    expect(migration).toContain("revoke all on function public.resolve_cw_courseware_overlay(jsonb, jsonb)");
    expect(migration).toContain("revoke all on function public.cw_session_courseware_template(uuid)");
  });

  it("grants member-scoped reads only to the active substitute for that session", () => {
    expect(substituteMembershipMigration).toContain(
      "session.teacher_override = uid and substitute.id is not null",
    );
    expect(substituteMembershipMigration).toContain("substitute.is_active");
    expect(substituteMembershipMigration).not.toContain("is_session_teacher(sid, uid)");
    expect(substituteMembershipMigration).not.toContain("is_admin(uid)");
    expect(substituteMembershipMigration).toContain(
      'drop policy if exists "sessions_select_member" on public.class_sessions',
    );
    expect(substituteMembershipMigration).toContain(
      "using (public.is_session_member(id, (select auth.uid())))",
    );
    expect(substituteMembershipMigration).toContain(
      'create policy "classrooms_select_session_substitute"',
    );
    expect(substituteMembershipMigration).toContain(
      'create policy "cls_members_select_session_substitute"',
    );
    expect(assertions).toContain("unrelated_staff_not_member");
    expect(assertions).toContain("substitute_session_reads_ok");
    expect(assertions).toContain("substitute_session_row_ok");
    expect(assertions).toContain("substitute_classroom_row_ok");
    expect(assertions).toContain("substitute_roster_ok");
    expect(assertions).toContain("removed_substitute_session_hidden");
    expect(assertions).toContain("removed_substitute_classroom_hidden");
    expect(assertions).toContain("removed_substitute_roster_hidden");
    expect(assertions).toContain("removed_substitute_not_member");
  });

  it("derives teacher role from the exact substitute session only on the live route", () => {
    expect(classroomActions).toContain(
      "getClassroom(id: string, sessionId?: string)",
    );
    expect(classroomActions).toContain('.eq("teacher_override", user.id)');
    expect(classroomActions).toContain(
      'const myRole = classroomRole ?? (sessionSubstitute ? "teacher" : null)',
    );
    expect(classroomActions).toContain(
      'if (myRole === "teacher" && !sessionSubstitute)',
    );
    expect(livePage).toContain("getClassroom(classId, sessionId)");
  });

  it("recomputes the authoritative overlay in both preparation and start freeze RPCs", () => {
    for (const functionName of [
      "freeze_session_courseware",
      "save_session_prepared_courseware",
    ]) {
      const body = migration.match(new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
      ))?.[0];
      expect(body).toBeDefined();
      expect(body).toContain("resolve_cw_courseware_overlay");
      expect(body).toContain("cw_session_selected_courseware_template");
      expect(body).toContain("COURSEWARE_RELEASE_PROJECTION_MISMATCH");
      expect(body).toContain("RELEASE_MISMATCH");
    }
  });

  it("loads classroom and reviewer docs in immutable snapshot order", () => {
    for (const functionName of [
      "get_session_page_docs",
      "get_session_preparation_review_page_docs",
    ]) {
      const body = migration.match(new RegExp(
        `create or replace function public\\.${functionName}[\\s\\S]*?\\n\\$\\$;`,
      ))?.[0];
      expect(body).toBeDefined();
      expect(body).toContain("with ordinality entry(value, ordinal)");
      expect(body).toContain("entry.ordinal::int");
      expect(body).toContain("order by entry.ordinal");
      expect(body).not.toContain("order by page.page_no");
    }
  });

  it("routes every unfrozen UI and action consumer through the session release resolver", () => {
    expect(classroomActions).toContain("getSessionCoursewareTemplate(sessionId)");
    expect(preparationActions).toContain("getSessionCoursewareTemplate(value.sessionId)");
    expect(preparationPanel).toContain("getSessionCoursewareTemplate(detail.id)");
    expect(livePage).toContain("getSessionCoursewareTemplate(sessionId)");
    for (const source of [classroomActions, preparationActions, preparationPanel, livePage]) {
      expect(source).not.toContain("getLectureCoursewareTemplate(");
    }
  });

  it("has rollback-safe DB assertions for drift, forgery, track choice, overlay and replay order", () => {
    expect(assertions).toContain("begin;");
    expect(assertions).toContain("rollback;");
    expect(assertions).toContain("native_projection_ok");
    expect(assertions).toContain("release_and_rollback_projection_ok");
    expect(assertions).toContain("RELEASE_TEMPLATE_MUTATION_ACCEPTED");
    expect(assertions).toContain("FORGED_RELEASE_COURSEWARE_ACCEPTED");
    expect(assertions).toContain("selected_release_freeze_ok");
    expect(assertions).toContain("release_page_doc_order_ok");
  });

  it("uses one atomic migration transaction", () => {
    expect(migration.trimStart().startsWith("-- SML-0")).toBe(true);
    expect(migration).toContain("\nbegin;\n");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
  });
});
