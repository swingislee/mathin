import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20260720000200_p4h_lifecycle_rpcs.sql"),
  "utf8",
);

describe("P4H lifecycle migration contract", () => {
  it("defines every controlled lifecycle RPC and locks the direct delete path", () => {
    for (const rpc of [
      "transition_course_status",
      "trash_course",
      "restore_course",
      "get_course_lifecycle_impact",
      "archive_lecture",
      "restore_lecture",
      "get_lecture_lifecycle_impact",
      "save_teaching_plan",
      "transition_classroom_status",
      "archive_classroom",
      "trash_classroom",
      "restore_classroom",
      "assign_classroom_staff",
      "remove_classroom_staff",
      "cancel_session",
      "restore_session",
      "void_session",
    ]) {
      expect(migration).toContain(`function public.${rpc}`);
    }
    expect(migration).toContain("raise exception 'LECTURE_DELETE_DISABLED'");
    expect(migration).toContain("raise exception 'STALE_WRITE'");
    expect(migration).toContain("revoke update (deleted_at) on public.class_sessions from authenticated");
  });
});
