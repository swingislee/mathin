import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const checks = [
  ["student migration", "supabase/migrations/20260712000200_p4d0_student_lifecycle.sql", ["import_students", "soft_delete_student", "deleted_at is null"]],
  ["course CRUD", "supabase/migrations/20260712000300_p4d1_course_class_crud.sql", ["reorder_course_lectures", "LECTURE_IN_USE"]],
  ["activities", "supabase/migrations/20260712000400_p4d2_activities.sql", ["ACTIVITY_FULL", "follow_up_status='trialed'", "kind in ('note','call','class','visit','activity')"]],
  ["reviews", "supabase/migrations/20260712000500_p4d3_session_reviews.sql", ["save_session_reviews", "get_my_session_reviews", "knowledge_summary"]],
  ["videos", "supabase/migrations/20260712000600_p4d4_session_videos.sql", ["session-videos", "get_my_reviewed_videos", "reviewed_at is not null"]],
  ["audit hardening", "supabase/migrations/20260712000800_p4d6_audit_hardening.sql", ["delete_session_video", "revoke delete on public.courses", "revoke update(deleted_at)"]],
  ["video upload RLS", "supabase/migrations/20260712000900_p4d6_video_upload_policy_fix.sql", ["can_upload_session_video", "session_videos_insert_scope"]],
  ["video self-read RLS", "supabase/migrations/20260712001000_p4d6_video_select_policy_fix.sql", ["is_student_self", "session_videos_select_scope"]],
  ["renewal", "supabase/migrations/20260712000700_p4d5_recover_student.sql", ["recover_lost_student", "流失回流"]],
  ["permissions", "src/features/school/permissions.ts", ["activity.manage", "review.write", "video.review", "student.import", "student.delete"]],
  ["activity UI", "src/app/[locale]/dashboard/activities/page.tsx", ["ActivitiesManager"]],
  ["video UI", "src/features/school/VideoReviewPanel.tsx", ["playbackRate", "currentTime-=10", "currentTime+=10"]],
  ["seven buckets", "src/features/school/followups.ts", ["renewal", "lost", "<=3"]],
  ["database transaction audit", "scripts/verify-p4d-db.sql", ["ACTIVITY_FULL", "save_session_reviews", "rollback", "database transaction audit passed"]],
];

let failures = 0;
for (const [name, path, needles] of checks) {
  const text = await read(path);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) {
    failures += 1;
    console.error(`FAIL ${name}: ${path} missing ${missing.join(", ")}`);
  } else console.log(`PASS ${name}`);
}
if (failures) process.exit(1);
console.log(`P4D static contract audit passed (${checks.length} groups).`);
