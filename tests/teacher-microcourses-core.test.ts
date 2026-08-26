import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORGANIZATION_FEATURE_KEYS } from "@/features/school/organization-settings-contract";
import { PERMISSION_KEYS } from "@/features/school/permissions";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read("supabase/migrations/20260826000200_teacher_microcourses_core.sql");

describe("DEV-TMC-1 teacher microcourse core", () => {
  it("keeps the capability fail-closed and separate from global Studio permissions", () => {
    expect(PERMISSION_KEYS).toContain("courseware.microcourse.author");
    expect(ORGANIZATION_FEATURE_KEYS).toContain("teaching.teacher_microcourses_v1");
    expect(migration).toContain("'teaching.teacher_microcourses_v1', 1, false");
    expect(migration).toMatch(/role_row\.key = 'teacher'[\s\S]*courseware\.microcourse\.author/);
    expect(migration).not.toMatch(/role_row\.key = 'teacher'[\s\S]{0,180}courseware\.page\.edit/);
    expect(migration).not.toMatch(/role_row\.key = 'teacher'[\s\S]{0,180}'course\.manage'/);
  });

  it("preserves curriculum uniqueness while allowing same-dimension microcourses", () => {
    expect(migration).toContain("add column course_kind text not null default 'curriculum'");
    expect(migration).toContain("check (course_kind in ('curriculum', 'microcourse'))");
    expect(migration).toContain("alter table public.courses alter column term drop not null");
    expect(migration).toContain("course_kind = 'microcourse' or term is not null");
    expect(migration).toMatch(
      /create unique index courses_active_curriculum_variant_idx[\s\S]*course_kind = 'curriculum'/,
    );
    expect(migration).not.toMatch(
      /create unique index courses_active_curriculum_variant_idx[\s\S]{0,240}course_kind = 'microcourse'/,
    );
  });

  it("maps one free session to one hidden course and one lecture", () => {
    expect(migration).toContain("source_session_id uuid not null unique");
    expect(migration).toContain("course_id uuid not null unique");
    expect(migration).toContain("lecture_id uuid not null unique");
    expect(migration).toContain("MICROCOURSE_SOURCE_MUST_BE_FREE_SESSION");
    expect(migration).toContain("MICROCOURSE_REQUIRES_ONE_LECTURE");
    expect(migration).toContain("'teacher-microcourses'");
    expect(migration).toContain("'draft', 'production', 'microcourse', uid");
  });

  it("uses immutable and independently advancing metadata heads", () => {
    expect(migration).toContain("draft_metadata_revision_id uuid");
    expect(migration).toContain("published_metadata_revision_id uuid");
    expect(migration).toContain("teacher_microcourse_metadata_revisions_immutable");
    expect(migration).toContain("teacher_microcourse_review_snapshots_immutable");
    expect(migration).toContain("MICROCOURSE_REVISION_IMMUTABLE");
    expect(migration).toContain("metadata_revision_id uuid not null");
    expect(migration).toContain("h5_hashes jsonb not null default '[]'::jsonb");
  });

  it("separates author, reviewer, session teacher, and published reader scopes", () => {
    expect(migration).toContain("create function public.can_author_teacher_microcourse");
    expect(migration).toContain("microcourse_row.author_id = p_uid");
    expect(migration).toContain("public.is_session_teacher(microcourse_row.source_session_id, p_uid)");
    expect(migration).toContain("public.has_perm(p_uid, 'courseware.review')");
    expect(migration).toContain("create policy \"cw_page_revisions_select_scoped\"");
    expect(migration).toMatch(
      /cw_page_docs_select_scoped[\s\S]*course_kind = 'curriculum'[\s\S]*can_read_teacher_microcourse_draft_for_lecture/,
    );
    expect(migration).toMatch(
      /can_read_cw_page_revision_scoped[\s\S]*cw_lecture_releases[\s\S]*snapshot_item ->> 'revisionId'/,
    );
  });

  it("registers the development-track gate without claiming production deployment", () => {
    const roadmap = read("docs/plan/04-roadmap.md");
    const completeness = read("docs/plan/25-production-1.0-product-completeness.md");
    expect(roadmap).toContain("DEV-TMC-1 · 普通教师短期微课孵化与校内共享");
    expect(roadmap).toContain("生产默认关闭");
    expect(completeness).toContain("该能力由 `teaching.teacher_microcourses_v1` 默认关闭");
  });
});
