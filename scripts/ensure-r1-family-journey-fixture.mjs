import fs from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { createClient } from "@supabase/supabase-js";

const STUDENT_EMAIL = "test-student@mathin.local";
const TEACHER_EMAIL = "test-teacher@mathin.local";
const SOURCE_TITLE = "R1_BROWSER_FIXTURE_FAMILY_JOURNEY_SOURCE";
const TARGET_TITLE = "R1_BROWSER_FIXTURE_FAMILY_JOURNEY_TARGET";
const EXTERNAL_CHANNELS = ["email", "sms", "wechat", "webhook"];

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

function isPrivateDevelopmentHost(hostname) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    || /^(fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/i.test(hostname);
}

async function assertPrivateDevelopmentTarget(url) {
  const hostname = new URL(url).hostname;
  if (isPrivateDevelopmentHost(hostname)) return;
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !isPrivateDevelopmentHost(address))) {
    throw new Error("R1 family journey fixtures are restricted to private development hosts");
  }
}

async function findUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  throw new Error(`Required fixed test user is missing: ${email}`);
}

async function assertExternalChannelsDisabled(admin) {
  const { data, error } = await admin
    .from("integration_channels")
    .select("channel,status")
    .in("channel", EXTERNAL_CHANNELS);
  if (error) throw error;
  const statuses = new Map((data ?? []).map((row) => [row.channel, row.status]));
  const unsafe = EXTERNAL_CHANNELS.filter((channel) => statuses.get(channel) !== "disabled");
  if (unsafe.length > 0) {
    throw new Error(`External integration channels must be disabled for browser fixtures: ${unsafe.join(", ")}`);
  }
}

function pickClass(classes, preferred, excluded = new Set()) {
  const candidates = classes.filter((row) => !excluded.has(row.id));
  return candidates.find((row) => preferred.some((fragment) => row.name.includes(fragment))) ?? candidates[0] ?? null;
}

async function resolveJourneyActors(admin) {
  const [studentUser, teacherUser] = await Promise.all([
    findUserByEmail(admin, STUDENT_EMAIL),
    findUserByEmail(admin, TEACHER_EMAIL),
  ]);
  const { data: student, error: studentError } = await admin
    .from("students")
    .select("id,name")
    .eq("user_id", studentUser.id)
    .is("deleted_at", null)
    .single();
  if (studentError) throw studentError;

  const [{ data: enrollments, error: enrollmentError }, { data: memberships, error: membershipError }] = await Promise.all([
    admin.from("enrollments").select("classroom_id").eq("student_id", student.id).eq("status", "active"),
    admin.from("classroom_members").select("classroom_id").eq("user_id", teacherUser.id).eq("role", "teacher"),
  ]);
  if (enrollmentError) throw enrollmentError;
  if (membershipError) throw membershipError;

  const enrolledIds = new Set((enrollments ?? []).map((row) => row.classroom_id));
  const teacherIds = new Set((memberships ?? []).map((row) => row.classroom_id));
  const availableIds = [...teacherIds];
  if (availableIds.length < 2) throw new Error("The fixed teacher needs at least two managed classrooms for a cross-class makeup fixture");

  const { data: classrooms, error: classroomError } = await admin
    .from("classrooms")
    .select("id,name,course_id,operational_status,trashed_at")
    .in("id", availableIds)
    .is("trashed_at", null)
    .neq("operational_status", "completed");
  if (classroomError) throw classroomError;

  const sourceClasses = (classrooms ?? []).filter((row) => enrolledIds.has(row.id));
  const sourceClass = pickClass(sourceClasses, ["S班", "测试班"]);
  if (!sourceClass) throw new Error("No active classroom is shared by the fixed student and teacher");
  if (!sourceClass.course_id) throw new Error("The source fixture classroom must be linked to a course");

  const { data: sourceLecture, error: lectureError } = await admin
    .from("course_lectures")
    .select("id,no")
    .eq("course_id", sourceClass.course_id)
    .eq("status", "active")
    .not("current_release_id", "is", null)
    .order("no", { ascending: true })
    .limit(1)
    .single();
  if (lectureError) throw lectureError;

  const targetClasses = (classrooms ?? []).filter((row) => !enrolledIds.has(row.id));
  const targetClass = pickClass(targetClasses, ["A[全国版]", "A班", "A"], new Set([sourceClass.id]))
    ?? pickClass(classrooms ?? [], ["A[全国版]", "A班", "A"], new Set([sourceClass.id]));
  if (!targetClass) throw new Error("No distinct teacher-managed classroom is available for the makeup target");

  return { student, teacherId: teacherUser.id, sourceClass, sourceLecture, targetClass };
}

async function ensureSession(admin, { title, classroomId, daysFromNow, lecture = null }) {
  const { data: existing, error: existingError } = await admin
    .from("class_sessions")
    .select("id,classroom_id,title,lecture_id,lecture_no,scheduled_at,started_at,ended_at,deleted_at")
    .eq("title", title)
    .limit(2);
  if (existingError) throw existingError;
  if ((existing ?? []).length > 1) throw new Error(`Duplicate fixture sessions found for ${title}`);
  if (existing?.[0]) {
    const session = existing[0];
    if (session.classroom_id !== classroomId || session.deleted_at || session.started_at || session.ended_at) {
      throw new Error(`Existing fixture session is not reusable: ${title}`);
    }
    if (!session.scheduled_at || Date.parse(session.scheduled_at) <= Date.now()) {
      throw new Error(`Existing fixture session is no longer in the future: ${title}`);
    }
    if (lecture && (session.lecture_id !== lecture.id || session.lecture_no !== lecture.no)) {
      const { data: updated, error: updateError } = await admin
        .from("class_sessions")
        .update({ lecture_id: lecture.id, lecture_no: lecture.no })
        .eq("id", session.id)
        .select("id,classroom_id,title,lecture_id,lecture_no,scheduled_at,started_at,ended_at,deleted_at")
        .single();
      if (updateError) throw updateError;
      return { ...updated, created: false, lectureLinked: true };
    }
    return { ...session, created: false, lectureLinked: false };
  }

  const scheduledAt = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  const { data: created, error: createError } = await admin.from("class_sessions").insert({
    classroom_id: classroomId,
    title,
    courseware: [],
    scheduled_at: scheduledAt,
    duration_min: 90,
    lecture_id: lecture?.id ?? null,
    lecture_no: lecture?.no ?? null,
  }).select("id,classroom_id,title,lecture_id,lecture_no,scheduled_at,started_at,ended_at,deleted_at").single();
  if (createError) throw createError;
  return { ...created, created: true, lectureLinked: Boolean(lecture) };
}

async function readJourneyState(admin, sourceSessionId, studentId) {
  const { data: requests, error: requestError } = await admin
    .from("session_leave_requests")
    .select("id,status,created_at")
    .eq("session_id", sourceSessionId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (requestError) throw requestError;
  const { data: changes, error: changeError } = await admin
    .from("session_changes")
    .select("id,to_session,created_at")
    .eq("session_id", sourceSessionId)
    .eq("student_id", studentId)
    .eq("kind", "makeup")
    .order("created_at", { ascending: false })
    .limit(1);
  if (changeError) throw changeError;
  return {
    leaveRequest: requests?.[0] ?? null,
    makeupChange: changes?.[0] ?? null,
  };
}

loadLocalEnv();
if (process.env.R1_DEV_TEST_FIXTURES !== "1") throw new Error("Set R1_DEV_TEST_FIXTURES=1 to modify development fixtures");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Supabase server environment is required");
await assertPrivateDevelopmentTarget(url);

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
await assertExternalChannelsDisabled(admin);
const actors = await resolveJourneyActors(admin);
const source = await ensureSession(admin, {
  title: SOURCE_TITLE,
  classroomId: actors.sourceClass.id,
  daysFromNow: 3,
  lecture: actors.sourceLecture,
});
const target = await ensureSession(admin, {
  title: TARGET_TITLE,
  classroomId: actors.targetClass.id,
  daysFromNow: 10,
});
const state = await readJourneyState(admin, source.id, actors.student.id);

console.log(JSON.stringify({
  student: { id: actors.student.id, name: actors.student.name, email: STUDENT_EMAIL },
  teacher: { id: actors.teacherId, email: TEACHER_EMAIL },
  source: { ...source, classroomName: actors.sourceClass.name },
  target: { ...target, classroomName: actors.targetClass.name },
  state,
  externalChannels: "disabled",
}, null, 2));
