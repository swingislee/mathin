import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260729000200_r1_family_learning_actions.sql");
const privacyMigration = read("supabase/migrations/20260730010000_r1_family_portal_visibility.sql");
const relationshipMigration = read("supabase/migrations/20260730010100_r1_guardian_relationship_revocation.sql");

const leaveMakeupMigration = read("supabase/migrations/20260730010200_r1_leave_makeup_family_journey.sql");
const leaveNotificationMigration = read("supabase/migrations/20260730010300_r1_leave_notification_owner_fix.sql");
const availabilityMigration = read("supabase/migrations/20260730010400_r1_family_result_availability.sql");
const notificationLinksMigration = read("supabase/migrations/20260731000300_r1_family_notification_links.sql");
const studentIaMigration = read("supabase/migrations/20260731000600_r1_student_information_architecture.sql");
const taskBoundVideoMigration = read("supabase/migrations/20260731000900_r1_task_bound_video_submissions.sql");
const studentLearningChecksMigration = read("supabase/migrations/20260731001100_r1_student_learning_check_results.sql");

describe("R1-5 family learning contracts", () => {
  it("lets students and authorized guardians act on the same learning workflow", () => {
    expect(migration).toContain("create or replace function public.get_my_pending_assignments");
    expect(migration).toContain("create or replace function public.submit_assignment_for_student");
    expect(migration).toContain("'grades' = any(guardian_row.scope)");
    expect(migration).toContain("create or replace function public.can_upload_student_media");
    expect(migration).toContain("'video' = any(guardian_row.scope)");
  });

  it("shows students only their own learning checks after the session ends", () => {
    expect(studentLearningChecksMigration).toContain("create or replace function public.is_student_account");
    expect(studentLearningChecksMigration).toContain("create or replace function public.get_my_learning_check_results");
    expect(studentLearningChecksMigration).toContain("session_row.ended_at is not null");
    expect(studentLearningChecksMigration).toContain("student_row.user_id = auth.uid()");
    expect(studentLearningChecksMigration).toContain("session_learning_check_results.student_id");
    expect(studentLearningChecksMigration).not.toContain("public.guardian_can");
  });

  it("renders ended learning checks in the student class and progress views", () => {
    const customer = read("src/features/school/customer.ts");
    const classPage = read("src/app/[locale]/dashboard/learning/classes/[classId]/page.tsx");
    const progressPage = read("src/app/[locale]/dashboard/progress/page.tsx");
    const results = read("src/features/school/StudentLearningCheckResults.tsx");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    expect(customer).toContain('rpc("get_my_learning_check_results"');
    expect(customer).toContain("position: row.check_position");
    expect(classPage).toContain("getMyLearningCheckResults({ classroomId: classId })");
    expect(classPage).toContain("<StudentLearningCheckResults");
    expect(progressPage).toContain("getMyLearningCheckResults");
    expect(progressPage).toContain("<StudentLearningCheckResults");
    expect(progressPage).toContain("safe(getMyLearningCheckResults, [])");
    expect(results).toContain("learningStatus_");
    expect(results).toContain("showClassroom");
    for (const messages of [zh, en]) {
      expect(messages.school.students.learningChecksTitle).toBeTruthy();
      expect(messages.school.students.learningChecksIntro).toBeTruthy();
      expect(messages.school.students.learningChecksEmpty).toBeTruthy();
      expect(messages.school.students.learningCheckCount).toBeTruthy();
    }
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

  it("keeps the parent home centered on children, tasks, and leave", () => {
    const parentHome = read("src/features/school/home/ParentHome.tsx");
    const assignmentPage = read("src/app/[locale]/dashboard/assignments/page.tsx");
    const leavePanel = read("src/features/school/LeaveRequestPanel.tsx");
    const tiles = read("src/features/school/tiles.ts");
    expect(parentHome).toContain('/dashboard/children?child=');
    expect(parentHome).toContain('/dashboard/assignments?child=');
    expect(parentHome).toContain('#leave');
    expect(parentHome).toContain('customerT("goChildDetail")');
    expect(parentHome).not.toContain('from("game_leaderboard")');
    expect(parentHome).not.toContain('from("posts")');
    expect(parentHome).not.toContain('pickEligible("parent"');
    expect(parentHome).toContain("childKeys.every((key) => shownKeys.has(key))");
    expect(parentHome).toContain("mergeTileLayout(eligible, null");
    expect(tiles).toContain('return [...childKeys, "bindChild"]');
    expect(assignmentPage).toContain("ManagedVideoUploadPanel");
    expect(leavePanel).toContain("submitSessionLeaveRequestAction");
  });

  it("opens video submission only from a published, incomplete task", () => {
    const assignmentPage = read("src/app/[locale]/dashboard/assignments/page.tsx");
    const panel = read("src/features/school/ManagedVideoUploadPanel.tsx");
    expect(assignmentPage).toContain("rawVideoTask");
    expect(assignmentPage).toContain("!task.submitted");
    expect(assignmentPage).toContain("videoTaskId: task.videoTaskId");
    expect(assignmentPage).not.toContain("query.videoSession");
    expect(panel).toContain("video_task_id: task.videoTaskId");
    expect(panel).not.toContain('rpc("get_my_video_sessions")');
    expect(taskBoundVideoMigration).toContain("session_videos.video_task_id is not null");
    expect(taskBoundVideoMigration).toContain("task_row.published_at is not null");
    expect(taskBoundVideoMigration).toContain("video_row.video_task_id = task_row.id");
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

  it("keeps student notifications inside task-oriented learning destinations", () => {
    const assignmentPage = read("src/app/[locale]/dashboard/assignments/page.tsx");
    const courseworkPage = read("src/app/[locale]/dashboard/coursework/page.tsx");
    const progressPage = read("src/app/[locale]/dashboard/progress/page.tsx");
    const notifications = read("src/features/events/notifications.ts");
    const studentHome = read("src/features/school/home/StudentHome.tsx");
    const routes = read("src/features/school/dashboard-routes.ts");
    expect(notificationLinksMigration).toContain("recipient_is_student");
    expect(studentIaMigration).toContain("'/dashboard/coursework#leave'");
    expect(studentIaMigration).toContain("'/dashboard/progress#learning-results'");
    expect(studentIaMigration).toContain("update public.notifications notification_row");
    expect(notifications).toContain('environment === "learning"');
    expect(notifications).toContain("studentLearningLink(type)");
    expect(assignmentPage).not.toContain('id="attendance"');
    expect(assignmentPage).not.toContain("<LeaveRequestPanel");
    expect(assignmentPage).not.toContain("FamilyLearningResults");
    expect(courseworkPage).toContain('id="attendance"');
    expect(courseworkPage).toContain("<LeaveRequestPanel");
    expect(progressPage).toContain('id="learning-results"');
    expect(progressPage).toContain("<FamilyLearningResults");
    expect(studentHome).toContain('/dashboard/coursework#leave');
    expect(studentHome).toContain('/dashboard/progress#learning-results');
    expect(studentHome).toContain("schoolTileKeys");
    expect(routes).toContain('href: "/dashboard/coursework"');
    expect(routes).toContain('href: "/dashboard/progress"');
  });

  it("keeps draft learning results out of family projections", () => {
    expect(privacyMigration).toContain("session_reviews_invalidate_family_brief");
    expect(privacyMigration).toContain("published_at = null");
    expect(privacyMigration).toContain("join public.session_family_briefs brief_row");
    expect(privacyMigration).toContain("brief_row.published_at is not null");
    expect(privacyMigration).toContain("public.guardian_can(student_row.id, uid, 'grades')");
    expect(privacyMigration).not.toContain("coalesce(brief_row.learning_summary, session_row.knowledge_summary)");
  });

  it("isolates same-name children by stable student id", () => {
    const schedule = read("src/features/school/actions/schedule.ts");
    const childrenPage = read("src/app/[locale]/dashboard/children/page.tsx");
    const parentHome = read("src/features/school/home/ParentHome.tsx");
    expect(privacyMigration).toMatch(/get_my_schedule[\s\S]*student_id uuid/);
    expect(privacyMigration).toMatch(/get_my_attendance[\s\S]*student_id uuid/);
    expect(schedule).toContain("studentId: row.student_id");
    expect(childrenPage).toContain("entry.studentId === activeId");
    expect(childrenPage).toContain("row.studentId === activeId");
    expect(parentHome).toContain("entry.studentId === child.studentId");
  });

  it("does not present an unloaded guardian list as an empty relationship", () => {
    const panel = read("src/features/school/GuardianScopePanel.tsx");
    expect(panel).toContain("const loading = loaded.studentId !== studentId");
    expect(panel).toContain("loading &&");
    expect(panel).toContain("!loading && rows.length === 0");
    expect(panel).toContain('loadingT("loading")');
  });

  it("lets a guardian revoke only their own relationship without window.confirm", () => {
    const actions = read("src/features/school/customer-actions.ts");
    const childrenPage = read("src/app/[locale]/dashboard/children/page.tsx");
    const panel = read("src/features/school/GuardianRelationshipPanel.tsx");
    expect(relationshipMigration).toContain("revoke_my_guardian_relationship");
    expect(relationshipMigration).toContain("guardian.relationship_revoked");
    expect(relationshipMigration).toContain("'withdrawn', 'guardian_binding'");
    expect(relationshipMigration).toContain("set is_primary = true");
    expect(actions).toContain("revokeMyGuardianRelationshipAction");
    expect(childrenPage).toContain("getMyGuardianRelationship(activeId)");
    expect(panel).toContain("<AlertDialog");
    expect(panel).not.toContain("window.confirm");
  });

  it("closes the leave approval and makeup scheduling journey for the whole family", () => {
    const customer = read("src/features/school/customer.ts");
    const panel = read("src/features/school/LeaveRequestPanel.tsx");
    expect(leaveMakeupMigration).toContain("with latest_makeup as");
    expect(leaveMakeupMigration).toContain("public.family_of_student(request_row.student_id, uid)");
    expect(leaveMakeupMigration).toContain("'to_schedule'");
    expect(leaveMakeupMigration).toContain("kind = 'makeup_followup'");
    expect(leaveMakeupMigration).toContain("session_changes_notify_family_makeup");
    expect(leaveMakeupMigration).toContain("'session_change.makeup'");
    expect(customer).toContain("makeupSessionId: row.makeup_session_id");
    expect(panel).toContain("leaveMakeup_");
    expect(panel).toContain("useLocale()");
    expect(panel).not.toContain("Intl.DateTimeFormat(undefined");
    expect(leaveNotificationMigration).toContain("notify_leave_request_roles_r1");
    expect(leaveNotificationMigration).not.toContain("assignment_row.classroom_id = classroom_id");
    expect(leaveNotificationMigration).toContain("select guardian_row.guardian_id");
  });

  it("shows pending and withdrawn result states without exposing draft content", () => {
    const customer = read("src/features/school/customer.ts");
    const results = read("src/features/school/FamilyLearningResults.tsx");
    const childrenPage = read("src/app/[locale]/dashboard/children/page.tsx");
    const parentHome = read("src/features/school/home/ParentHome.tsx");
    expect(availabilityMigration).toContain("family_visibility_state");
    expect(availabilityMigration).toContain("session_family_briefs_sync_visibility");
    expect(availabilityMigration).toContain("get_my_session_review_states");
    expect(availabilityMigration).toContain("coalesce(brief_row.family_visibility_state, 'pending')");
    expect(availabilityMigration).not.toContain("review_row.comment");
    expect(availabilityMigration).not.toContain("brief_row.learning_summary");
    expect(customer).toContain("getMySessionReviewStates");
    expect(results).toContain("reviewStatusHint_");
    expect(results).toContain("CustomerVideoButton");
    expect(childrenPage).toContain('id="learning-results"');
    expect(parentHome).toContain("recentReviewState.availabilityState");
  });

  it("renders the four required family special states in both locales", () => {
    const customer = read("src/features/school/customer.ts");
    const studentHome = read("src/features/school/home/StudentHome.tsx");
    const parentHome = read("src/features/school/home/ParentHome.tsx");
    const childrenPage = read("src/app/[locale]/dashboard/children/page.tsx");
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));
    for (const messages of [zh, en]) {
      expect(messages.school.customer.notBound).toBeTruthy();
      expect(messages.school.customer.noChildren).toBeTruthy();
      expect(messages.school.customer.payment_closed).toBeTruthy();
      expect(messages.school.students.reviewStatus_pending).toBeTruthy();
      expect(messages.school.students.reviewStatus_withdrawn).toBeTruthy();
    }
    expect(studentHome).toContain('customerT("notBound")');
    expect(parentHome).toContain('customerT("noChildren")');
    expect(customer).toContain('paymentStatus: financeEnabled ? row.payment_status : "closed"');
    expect(childrenPage).toContain('t(`payment_${summary.paymentStatus}`)');
  });

  it("covers every student-id family projection and parameterized foreign read", () => {
    const assertion = read("supabase/tests/r1_family_portal_assertions.sql");
    for (const rpc of [
      "get_my_schedule",
      "get_my_attendance",
      "get_my_learning_summary",
      "get_my_learning_check_results",
      "get_my_account",
      "get_my_pending_assignments",
      "get_my_session_reviews",
      "get_my_session_review_states",
      "get_my_reviewed_videos",
      "get_my_published_video_tasks",
      "get_my_video_sessions",
      "list_my_session_leave_requests",
    ]) {
      expect(assertion).toContain(`public.${rpc}`);
    }
    for (const rpc of [
      "get_customer_assignment",
      "get_customer_submission",
      "submit_assignment_for_student",
      "get_family_session_brief",
      "record_guardian_consent",
      "list_student_guardians",
      "set_guardian_scope",
      "issue_guardian_invite",
    ]) {
      expect(assertion).toContain(`public.${rpc}`);
    }
  });

  it("provides explicit development-only fixtures for unbound and multi-child families", () => {
    const fixtures = read("scripts/ensure-r1-family-test-fixtures.mjs");
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["r1:family-fixtures"]).toBe("node scripts/ensure-r1-family-test-fixtures.mjs");
    expect(fixtures).toContain('process.env.R1_DEV_TEST_FIXTURES !== "1"');
    expect(fixtures).toContain("assertNonProductionWriteTarget");
    expect(fixtures).toContain('markdownValue.startsWith("`")');
    expect(fixtures).toContain('updateUserById(user.id, { password, email_confirm: true })');
    expect(fixtures).not.toContain("isPrivateDevelopmentHost");
    expect(fixtures).toContain("test-parent-unbound@mathin.local");
    expect(fixtures).toContain("test-parent@mathin.local");
    expect(fixtures).toContain("test-student-2@mathin.local");
    expect(fixtures).toContain('role: "parent"');
    expect(fixtures).toContain('last_active_environment: "family"');
    expect(fixtures).toContain('scope: GUARDIAN_SCOPES');
    expect(fixtures).toContain('source: "migration"');
    expect(fixtures).not.toContain("deleteUser");
  });

  it("provides a fail-closed browser fixture for the leave and cross-class makeup journey", () => {
    const fixtures = read("scripts/ensure-r1-family-journey-fixture.mjs");
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["r1:family-journey-fixture"]).toBe("node scripts/ensure-r1-family-journey-fixture.mjs");
    expect(fixtures).toContain('process.env.R1_DEV_TEST_FIXTURES !== "1"');
    expect(fixtures).toContain("assertNonProductionWriteTarget");
    expect(fixtures).not.toContain("assertPrivateDevelopmentTarget");
    expect(fixtures).toContain("assertExternalChannelsDisabled");
    expect(fixtures).toContain('["email", "sms", "wechat", "webhook"]');
    expect(fixtures).toContain('statuses.get(channel) !== "disabled"');
    expect(fixtures).toContain("R1_BROWSER_FIXTURE_FAMILY_JOURNEY_SOURCE");
    expect(fixtures).toContain("R1_BROWSER_FIXTURE_FAMILY_JOURNEY_TARGET");
    expect(fixtures).toContain('const SOURCE_TITLE = "家庭学习旅程·常规课"');
    expect(fixtures).toContain('const TARGET_TITLE = "家庭学习旅程·补课"');
    expect(fixtures).toContain('.in("title", [title, ...legacyTitles])');
    expect(fixtures).toContain("titleMigrated: needsTitleMigration");
    expect(fixtures).toContain('.from("course_lectures")');
    expect(fixtures).toContain('lecture_id: lecture?.id ?? null');
    expect(fixtures).toContain('eq("kind", "makeup")');
    expect(fixtures).not.toContain("deleteUser");
  });

  it("checks fixed-account family boundaries through authenticated clients without writes", () => {
    const boundaryCheck = read("scripts/verify-r1-family-auth-boundaries.mjs");
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["r1:family-boundary-check"]).toBe("node scripts/verify-r1-family-auth-boundaries.mjs");
    expect(boundaryCheck).toContain('process.env.R1_DEV_TEST_FIXTURES !== "1"');
    expect(boundaryCheck).toContain('import { lookup } from "node:dns/promises"');
    expect(boundaryCheck).toContain("assertPrivateDevelopmentTarget");
    expect(boundaryCheck).toContain("test-student@mathin.local");
    expect(boundaryCheck).toContain("test-student-2@mathin.local");
    expect(boundaryCheck).toContain("test-parent-unbound@mathin.local");
    expect(boundaryCheck).toContain('client.rpc("get_my_students")');
    expect(boundaryCheck).toContain('client.rpc("get_my_schedule"');
    expect(boundaryCheck).toContain('client.rpc("get_my_session_review_states"');
    expect(boundaryCheck).toContain('client.rpc("get_my_learning_check_results"');
    expect(boundaryCheck).toContain("Student one has no ended-session learning check results");
    expect(boundaryCheck).toContain('clients.studentOne.rpc("get_customer_assignment"');
    expect(boundaryCheck).toContain('clients.unboundParent.rpc("get_customer_submission"');
    expect(boundaryCheck).toContain("requireDirectReadRejected");
    expect(boundaryCheck).not.toContain("submit_assignment_for_student");
    expect(boundaryCheck).not.toContain(".insert(");
    expect(boundaryCheck).not.toContain(".update(");
    expect(boundaryCheck).not.toContain(".delete(");
  });

});
