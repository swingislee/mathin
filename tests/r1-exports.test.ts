import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260801000900_r1_export_artifacts.sql");

describe("R1-7E controlled export contracts", () => {
  it("separates retained user-rights artifacts from immediate operational exports", () => {
    expect(migration).toContain("create table public.user_rights_export_artifacts");
    expect(migration).toContain("create table public.export_download_events");
    expect(migration).toContain("export_category in ('user_rights','operational')");
    expect(migration).toContain("account_portability_json");
    expect(migration).toContain("solution_record_webp");
    expect(migration).not.toContain("p_table_name");
  });

  it("builds role-specific allowlists and explicitly excludes internal or unrelated minor data", () => {
    expect(migration).toContain("user_rights_export_field_manifest");
    expect(migration).toContain("studentInternalRemark");
    expect(migration).toContain("studentBindCode");
    expect(migration).toContain("unpublishedLearningResults");
    expect(migration).toContain("profile_row.role = 'student'");
    expect(migration).toContain("profile_row.role = 'parent'");
    expect(migration).toContain("guardian_row.guardian_id = p_user_id");
    expect(migration).toContain("submission_row.user_id = p_user_id");
  });

  it("requires verified approval, hashes exact bytes, expires access, and purges retained content", () => {
    expect(migration).toContain("REQUEST_NOT_APPROVED");
    expect(migration).toContain("IDENTITY_NOT_VERIFIED");
    expect(migration).toContain("convert_to(serialized, 'UTF8')");
    expect(migration).toContain("now() + interval '7 days'");
    expect(migration).toContain("EXPORT_EXPIRED");
    expect(migration).toContain("purge_expired_user_rights_export_payloads");
    expect(migration).toContain("content_text = null, purged_at = now()");
  });

  it("keeps artifact content behind an audited subject-only download RPC", () => {
    expect(migration).toContain("download_user_rights_export");
    expect(migration).toContain("artifact_row.user_id <> uid");
    expect(migration).toContain("insert into public.export_download_events");
    expect(migration).toContain("grant select(id, request_id, user_id");
    expect(migration).not.toContain("grant select on public.user_rights_export_artifacts to authenticated");
  });

  it("audits the exact WebP bytes before the browser download starts", () => {
    const renderer = read("src/features/school/solution-record-export.ts");
    const archive = read("src/features/school/SessionSolutionArchive.tsx");
    const action = read("src/features/school/actions/exports.ts");
    expect(renderer).toContain('crypto.subtle.digest("SHA-256"');
    expect(renderer).toContain("await beforeDownload?.");
    expect(renderer.indexOf("await beforeDownload?.")).toBeLessThan(renderer.indexOf("link.click()"));
    expect(archive).toContain("recordSolutionRecordExportDownloadAction");
    expect(archive).toContain("solutionRecordId={record.id}");
    expect(action).toContain('rpc("record_solution_record_export_download"');
  });

  it("ships executable cross-student, expiry, PII, and operational-scope negatives", () => {
    const sql = read("supabase/tests/r1_export_artifacts_assertions.sql");
    expect(sql).toContain("R1_CROSS_STUDENT_EXPORT_DOWNLOAD_ACCEPTED");
    expect(sql).toContain("R1_PARENT_EXPORT_LEAKED_MINOR_DETAILS");
    expect(sql).toContain("R1_EXPIRED_EXPORT_DOWNLOAD_ACCEPTED");
    expect(sql).toContain("R1_UNAUTHORIZED_OPERATIONAL_EXPORT_ACCEPTED");
    expect(sql).toContain("R1_OPERATIONAL_EXPORT_AUDIT_VISIBLE_TO_STUDENT");
  });
});
