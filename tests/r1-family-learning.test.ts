import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260729000200_r1_family_learning_actions.sql");

describe("R1-5 family learning contracts", () => {
  it("lets students and authorized guardians act on the same learning workflow", () => {
    expect(migration).toContain("create or replace function public.get_my_pending_assignments");
    expect(migration).toContain("create or replace function public.submit_assignment_for_student");
    expect(migration).toContain("'grades' = any(guardian_row.scope)");
    expect(migration).toContain("create or replace function public.can_upload_student_media");
    expect(migration).toContain("'video' = any(guardian_row.scope)");
  });

  it("accepts photographed paper homework through governed private storage", () => {
    const form = read("src/features/classroom/assignments/SubmissionForm.tsx");
    const compression = read("src/lib/media/compress-image.ts");
    expect(migration).toContain("'assignment-submissions', 'assignment-submissions', false, 12582912");
    expect(migration).toContain("link_submission_managed_files");
    expect(form).toContain('capture="environment"');
    expect(form).toContain('from("assignment-submissions")');
    expect(form).toContain("compressHomeworkImage");
    expect(compression).toContain("canvas.toBlob");
  });

  it("gives parents direct assignment, video, and leave entry points", () => {
    const parentHome = read("src/features/school/home/ParentHome.tsx");
    const assignmentPage = read("src/app/[locale]/dashboard/assignments/page.tsx");
    const leavePanel = read("src/features/school/LeaveRequestPanel.tsx");
    expect(parentHome).toContain('/dashboard/assignments?child=');
    expect(parentHome).toContain('#video-upload');
    expect(parentHome).toContain('#leave');
    expect(assignmentPage).toContain("ManagedVideoUploadPanel");
    expect(leavePanel).toContain("submitSessionLeaveRequestAction");
  });

  it("targets assignment and leave notifications to students, guardians, and staff", () => {
    for (const trigger of [
      "assignments_notify_family",
      "submissions_notify_family",
      "session_leave_requests_notify_roles",
    ]) {
      expect(migration).toContain(trigger);
    }
    expect(migration).toContain("notify_family_learning_change");
    expect(migration).toContain("notify_leave_request_change");
    expect(migration).toContain("/dashboard/assignments/");
    expect(migration).toContain("/dashboard/children?child=");
  });
});