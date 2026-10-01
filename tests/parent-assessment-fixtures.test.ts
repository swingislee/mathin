import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { fixedPreviewActors, previewIdentitySql, requireMatchingPreviewCheck } from "../scripts/parent-assessment-fixtures-local.mjs";

const manifest = [
  "| 角色 | 邮箱 |",
  "| 管理员 admin | `demo_admin@mathin.local` |",
  "| 教师 staff/teacher | demo_teacher@mathin.local |",
  "| 学生 student | demo_student@mathin.local |",
  "| 学生2 student | demo_student2@mathin.local |",
  "| 家长 parent | demo_parent@mathin.local |",
  "| 未绑定家长 parent | demo_outsider@mathin.local |",
  "private password line is not an identity input",
].join("\n");

describe("local parent preview safety boundary", () => {
  it("resolves exactly the six existing manifest roles without carrying credentials", () => {
    const actors = fixedPreviewActors(manifest);
    expect(Object.keys(actors)).toHaveLength(6);
    expect(actors.admin).toBe("demo_admin@mathin.local");
    const sql = previewIdentitySql(actors);
    expect(sql).toContain("from auth.users where lower(email)=");
    expect(sql).toContain("test.parent_preview.second_student_user_id");
    expect(sql).toContain("from public.students where user_id=");
    expect(sql).not.toMatch(/password|\b(?:insert\s+into|update\s+public\.|delete\s+from)/i);
  });

  it("rejects missing, duplicate, overlapping or injectable identities before producing SQL", () => {
    expect(() => fixedPreviewActors(manifest.replace("| 学生2 student |", "| Unknown |"))).toThrow("FIXED_PREVIEW_MANIFEST_REQUIRED");
    expect(() => fixedPreviewActors(`${manifest}\n| 家长 parent | another@mathin.local |`)).toThrow("FIXED_PREVIEW_MANIFEST_REQUIRED");
    expect(() => fixedPreviewActors(manifest.replace("demo_outsider@mathin.local", "demo_parent@mathin.local"))).toThrow("FIXED_PREVIEW_ROLES_OVERLAP");
    expect(() => previewIdentitySql({ ...fixedPreviewActors(manifest), parent: "x'; select 1; --@mathin.local" })).toThrow("FIXED_PREVIEW_EMAIL_INVALID");
  });

  it("requires the checked inputs, database state and target within a bounded check window", () => {
    const now = Date.parse("2026-10-02T00:00:00Z");
    const expected = { inputHash: "source-and-private-input-digest", target: "local-target-digest", before: "database-state-digest" };
    const check = { ...expected, checkedAt: new Date(now - 1000).toISOString() };
    expect(() => requireMatchingPreviewCheck(check, expected, now)).not.toThrow();
    for (const key of ["inputHash", "target", "before"]) {
      expect(() => requireMatchingPreviewCheck({ ...check, [key]: "changed" }, expected, now)).toThrow("MATCHING_PREVIEW_CHECK_REQUIRED");
    }
    for (const checkedAt of ["invalid", new Date(now + 1).toISOString(), new Date(now - 31 * 60 * 1000).toISOString()]) {
      expect(() => requireMatchingPreviewCheck({ ...check, checkedAt }, expected, now)).toThrow("MATCHING_PREVIEW_CHECK_REQUIRED");
    }
    expect(() => requireMatchingPreviewCheck(null, expected, now)).toThrow("MATCHING_PREVIEW_CHECK_REQUIRED");
  });

  it("keeps fixture writes additive and routes coordination through the existing public RPCs", () => {
    const sql = fs.readFileSync("supabase/fixtures/parent-assessment-local.sql", "utf8");
    expect(sql).not.toMatch(/\b(?:create\s+table|delete\s+from|update\s+public\.|insert\s+into\s+auth\.)/i);
    expect(sql).toContain("v_class.purpose<>'test'");
    expect(sql).toContain("PREVIEW_LINKED_LEAD_CONFLICT");
    expect(sql).toContain("PREVIEW_REQUEST_OWNERSHIP_CONFLICT");
    expect(sql).toContain("public.request_parent_assessment(v_request_id,v_second,v_teacher,v_options)");
    expect(sql).toContain("public.set_invitation_assessor_availability(v_request_id,v_options)");
    expect(sql).toContain("public.miniapp_submit_intake(v_intake_request,'welcome',v_form.version");
    expect(sql).not.toContain("public.confirm_parent_assessment(");
    expect(sql).not.toContain("ensure_invitation_assessment_registration(");
  });
});
