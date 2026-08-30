import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIGURABLE_ORGANIZATION_FEATURE_KEYS,
  ORGANIZATION_FEATURE_KEYS,
} from "../src/features/school/organization-settings-contract";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260728000100_r1_organization_settings.sql");
const publishGuard = read("supabase/migrations/20260728000200_r1_public_publish_guard.sql");
const notebookPrivacy = read("supabase/migrations/20260812000100_r1_notebook_interaction_privacy.sql");
const notebookLifecycle = read("supabase/migrations/20260812000200_r1_notebook_publication_lifecycle.sql");
const notebookLifecycleSecurity = read("supabase/migrations/20260812000300_r1_notebook_lifecycle_security_followup.sql");
const notebookAssertions = read("supabase/tests/r1_notebook_assertions.sql");
const preparationUnlock = read("supabase/migrations/20260731000500_r1_preparation_archive_unlock.sql");

describe("R1-1 organization settings contracts", () => {
  it("keeps retired rollout history readable without exposing it as a live control", () => {
    expect(ORGANIZATION_FEATURE_KEYS).toContain("teaching.teacher_microcourse_browser_v2");
    expect(CONFIGURABLE_ORGANIZATION_FEATURE_KEYS).not.toContain("teaching.teacher_microcourse_browser_v2");
  });

  it("ships explicit organization, campus, calendar, rule, and flag schema with RLS", () => {
    for (const table of ["organizations", "campuses", "campus_rooms", "school_holidays", "organization_rule_versions", "feature_flag_versions"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("organization_rule_versions_immutable");
    expect(migration).toContain("feature_flag_versions_immutable");
    expect(migration).toContain("oldValue");
    expect(migration).toContain("effective_from");
  });

  it("keeps capabilities fail-closed and gates finance at database and application boundaries", () => {
    const auth = read("src/lib/auth.ts");
    const financePage = read("src/app/[locale]/dashboard/finance/page.tsx");
    const notebookActions = read("src/features/notebook/actions.ts");
    const notebookTopbar = read("src/features/notebook/workspace/WorkspaceTopbar.tsx");
    const layout = read("src/app/[locale]/dashboard/layout.tsx");
    expect(migration).toContain("coalesce((");
    expect(migration).toContain("), false)");
    expect(migration).toContain("p_key not like 'finance.%' or public.is_feature_enabled('finance.enabled')");
    expect(migration).toMatch(/get_my_orders\(\)[\s\S]*is_feature_enabled\('finance\.enabled'\)/);
    expect(auth).toContain('rpc("get_my_permission_keys")');
    expect(financePage).toContain('isFeatureEnabled("finance.enabled")');
    expect(layout).toContain('item.href !== "/dashboard/finance" || financeEnabled');
    expect(publishGuard).toContain("public.is_feature_enabled('public_content.publish')");
    expect(publishGuard).toContain('create policy "posts_insert_own"');
    expect(publishGuard).toContain('create policy "posts_update_own"');
    expect(notebookActions).toContain('p_flag_key: "public_content.publish"');
    expect(notebookTopbar).toContain('t("publishDisabled")');
  });

  it("uses generated defaults instead of test fixture UUIDs", () => {
    expect(migration).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(migration).not.toContain("ci-admin@mathin.local");
    expect(migration).toContain("default gen_random_uuid()");
    expect(migration).toContain("R1-1 explicit default");
    expect(migration).toContain("R1-1 fail-closed default");
  });

  it("keeps Notebook publication ownership and interaction privacy at the database boundary", () => {
    const notebookActions = read("src/features/notebook/actions.ts");
    const notebookTopbar = read("src/features/notebook/workspace/WorkspaceTopbar.tsx");
    const moderationPanel = read("src/features/notebook/post/ModerationPanel.tsx");
    const notebookFeed = read("src/app/[locale]/notebook/page.tsx");
    const notebookPost = read("src/app/[locale]/notebook/[postId]/page.tsx");
    const notebookHtml = read("src/features/notebook/html.ts");
    const dbAudit = read("scripts/run-r1-db-audit.mjs");
    expect(notebookPrivacy).toContain('revoke select on public.post_likes from anon');
    expect(notebookPrivacy).toContain('create policy "post_likes_select_own"');
    expect(notebookPrivacy).toMatch(/post_likes_insert_own[\s\S]*not p\.hidden[\s\S]*p\.review_status = 'approved'/);
    expect(notebookPrivacy).toContain('revoke update (note_id) on public.posts from authenticated');
    expect(notebookPrivacy).toMatch(/posts_insert_own[\s\S]*n\.owner_id = \(select auth\.uid\(\)\)[\s\S]*not n\.is_archived/);
    expect(notebookPrivacy).toMatch(/posts_update_own[\s\S]*hidden[\s\S]*public\.is_feature_enabled\('public_content\.publish'\)/);
    expect(notebookActions).toContain('const entityIdSchema = z.string().uuid()');
    expect(notebookActions).toContain('if (note.is_archived) throw new Error("NOTE_ARCHIVED")');
    expect(notebookLifecycle).toContain("create table public.notebook_post_revisions");
    expect(notebookLifecycle).toContain("create table public.notebook_post_lifecycle_events");
    expect(notebookLifecycle).toContain("submit_notebook_post_revision");
    expect(notebookLifecycle).toContain("review_notebook_post_revision");
    expect(notebookLifecycle).toContain("withdraw_notebook_post");
    expect(notebookLifecycle).toMatch(/revoke all on public\.posts from anon, authenticated/);
    expect(notebookLifecycle).toMatch(/moderation_status = 'hidden'[\s\S]*raise exception 'MODERATION_LOCKED'/);
    expect(notebookLifecycle).toMatch(/lifecycle_status = 'review'[\s\S]*r\.content = p_content[\s\S]*return jsonb_build_object/);
    expect(notebookLifecycle).toMatch(/notes_sync_notebook_post_state[\s\S]*after update of is_archived/);
    expect(notebookLifecycleSecurity).toContain("notes_00_require_archived_before_delete");
    expect(notebookLifecycleSecurity).toMatch(/if not old\.is_archived[\s\S]*NOTE_NOT_ARCHIVED/);
    expect(notebookLifecycleSecurity).toContain("source_note_version");
    expect(notebookLifecycleSecurity).toContain("source_snapshot_hash");
    expect(notebookLifecycleSecurity).toMatch(/note_row\.version <> p_expected_note_version[\s\S]*NOTE_VERSION_CONFLICT/);
    expect(notebookLifecycleSecurity).toMatch(/p_title is distinct from note_row\.title[\s\S]*SOURCE_SNAPSHOT_MISMATCH/);
    expect(notebookLifecycleSecurity).toMatch(/p_decision is null[\s\S]*raise exception 'VALIDATION'/);
    expect(notebookLifecycleSecurity).toMatch(/p_status is null[\s\S]*raise exception 'VALIDATION'/);
    expect(notebookLifecycleSecurity).toContain("drop function public.submit_notebook_post_revision(uuid, text, jsonb, text, text)");
    expect(notebookActions).toContain("publicationStatusSchema");
    expect(notebookActions).toContain("NotebookPublicationActionResult");
    expect(notebookActions).not.toContain("export const NOTEBOOK_PUBLICATION_STATUSES");
    expect(notebookActions).toContain('rpc("submit_notebook_post_revision"');
    expect(notebookActions).toContain("p_expected_note_version: note.version");
    expect(notebookActions).toContain('rpc("review_notebook_post_revision"');
    expect(notebookActions).toContain('rpc("withdraw_notebook_post"');
    expect(notebookTopbar).toContain('role={feedback.kind === "error" ? "alert" : "status"}');
    expect(moderationPanel).toContain('reviewNotebookPostAction');
    expect(moderationPanel).toContain('moderatePostAction');
    expect(notebookFeed).toMatch(/\.eq\("lifecycle_status", "published"\)[\s\S]*\.eq\("moderation_status", "active"\)/);
    expect(notebookPost).toContain("sanitizeNotebookHtml(post.content_html)");
    expect(notebookHtml).toContain('allowedSchemes: ["http", "https"]');
    expect(dbAudit).toContain('"r1_notebook_assertions.sql"');
    expect(notebookAssertions).toContain('R1_HIDDEN_POST_LIKE_WAS_ACCEPTED');
    expect(notebookAssertions).toContain('R1_DIRECT_POST_INSERT_WAS_ACCEPTED');
    expect(notebookAssertions).toContain('R1_ARCHIVED_NOTE_SUBMIT_WAS_ACCEPTED');
    expect(notebookAssertions).toContain('R1_PLATFORM_HIDE_WAS_BYPASSED');
    expect(notebookAssertions).toContain('history_is_traceable');
    for (const locale of ["zh", "en"] as const) {
      const messages = JSON.parse(read(`messages/${locale}.json`));
      for (const status of ["draft", "review", "published", "withdrawn", "revised"]) {
        expect(messages.notebook.workspace.publicationStatus[status]).toBeTruthy();
        expect(messages.notebook.public.lifecycle[status]).toBeTruthy();
      }
      for (const code of ["VALIDATION", "FORBIDDEN", "PUBLIC_PUBLISHING_DISABLED", "NOTE_VERSION_CONFLICT", "SOURCE_SNAPSHOT_MISMATCH", "INVALID_STATE", "MODERATION_LOCKED", "SERVER"]) {
        expect(messages.notebook.workspace.publicationErrors[code]).toBeTruthy();
        expect(messages.notebook.public.actionErrors[code]).toBeTruthy();
      }
    }
  });

  it("registers preparation archive editing as a fail-closed administrator switch", () => {
    const contract = read("src/features/school/organization-settings-contract.ts");
    expect(contract).toContain('"teaching.preparation_archive_edit"');
    expect(preparationUnlock).toContain("'teaching.preparation_archive_edit'");
    expect(preparationUnlock).toContain("'R1-5 fail-closed default'");
    expect(preparationUnlock).toMatch(/teaching\.preparation_archive_edit', 1, false/);
  });

  it("splits organization and location resources and retires the legacy settings route", () => {
    const routes = read("src/features/school/dashboard-routes.ts");
    const profilePage = read("src/app/[locale]/dashboard/organization/page.tsx");
    const campusesPage = read("src/app/[locale]/dashboard/campuses/page.tsx");
    const campusForm = read("src/features/school/CampusCreateDialog.tsx");
    const roomForm = read("src/features/school/CampusRoomCreateDialog.tsx");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(routes).toContain('href: "/dashboard/organization"');
    expect(routes).toContain('permission: "organization.profile.manage"');
    expect(routes).toContain('href: "/dashboard/campuses"');
    expect(routes).toContain('permission: "location.manage"');
    expect(routes).not.toContain('href: "/dashboard/organization-settings"');
    expect(fs.existsSync(path.join(root, "src/app/[locale]/dashboard/organization-settings/page.tsx"))).toBe(false);
    expect(profilePage).toContain('requirePerm(locale, "organization.profile.manage")');
    expect(campusesPage).toContain('requirePerm(locale, "location.manage")');
    expect(zh.school.organizationProfile.title).toBeTruthy();
    expect(en.school.organizationProfile.title).toBeTruthy();
    expect(zh.school.locations.title).toBeTruthy();
    expect(en.school.locations.title).toBeTruthy();
    expect(campusForm).not.toMatch(/campusCode|campus\.code|\bcode\b/);
    expect(roomForm).not.toMatch(/roomCode|room\.code|\bcode\b/);
    for (const key of ORGANIZATION_FEATURE_KEYS) {
      const suffix = key.replaceAll(".", "_");
      expect(zh.school.organization[`flag_${suffix}`]).toBeTruthy();
      expect(zh.school.organization[`flagHelp_${suffix}`]).toBeTruthy();
      expect(en.school.organization[`flag_${suffix}`]).toBeTruthy();
      expect(en.school.organization[`flagHelp_${suffix}`]).toBeTruthy();
    }
  });

  it("validates V2 names and timezones without accepting administrator-provided codes", () => {
    const actions = read("src/features/school/actions/organization-locations.ts");
    const server = read("src/features/school/organization-locations.ts");
    expect(actions).toContain('.refine(isIanaTimezone)');
    expect(actions).toContain('"CAMPUS_NAME_EXISTS"');
    expect(actions).toContain('"ROOM_NAME_EXISTS"');
    expect(actions).not.toMatch(/campusCode|roomCode|p_code/);
    expect(server).not.toContain("row.code");
    expect(server).not.toMatch(/\n\s+code:\s/);
  });
});
