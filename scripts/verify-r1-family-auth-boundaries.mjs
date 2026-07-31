import fs from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { createClient } from "@supabase/supabase-js";

const ACCOUNT_EMAILS = {
  studentOne: "test-student@mathin.local",
  studentTwo: "test-student-2@mathin.local",
  parent: "test-parent@mathin.local",
  unboundParent: "test-parent-unbound@mathin.local",
};

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
    throw new Error("R1 authenticated family boundary checks are restricted to private development hosts");
  }
}

function readUnifiedTestPassword() {
  const file = path.join(process.cwd(), ".claude", "test-accounts.local.md");
  if (!fs.existsSync(file)) throw new Error("Local test account manifest is required");
  const match = fs.readFileSync(file, "utf8").match(/\*\*统一密码：(.+?)\*\*/);
  if (!match?.[1]) throw new Error("Unified test password is missing from the local manifest");
  const markdownValue = match[1].trim();
  return markdownValue.startsWith("`") && markdownValue.endsWith("`")
    ? markdownValue.slice(1, -1) : markdownValue;
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

async function createAuthenticatedClient(url, key, email, password) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error(`Unable to sign in fixed test user: ${email}`);
  return client;
}

async function requireRows(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function assertOnlyStudentIds(rows, allowedIds, label, key = "student_id") {
  const leaked = rows.filter((row) => row[key] && !allowedIds.has(row[key]));
  if (leaked.length > 0) throw new Error(`${label} leaked ${leaked.length} foreign student row(s)`);
}

async function readProjectionSnapshot(client, allowedIds, label) {
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const calls = [
    ["students", client.rpc("get_my_students"), "id"],
    ["schedule", client.rpc("get_my_schedule", { p_from: from, p_to: to }), "student_id"],
    ["attendance", client.rpc("get_my_attendance", { p_from: from, p_to: to }), "student_id"],
    ["learningSummary", client.rpc("get_my_learning_summary"), "student_id"],
    ["pendingAssignments", client.rpc("get_my_pending_assignments"), "student_id"],
    ["sessionReviews", client.rpc("get_my_session_reviews", { p_from: from, p_to: to }), "student_id"],
    ["sessionReviewStates", client.rpc("get_my_session_review_states", { p_from: from, p_to: to }), "student_id"],
    ["reviewedVideos", client.rpc("get_my_reviewed_videos"), "student_id"],
    ["publishedVideoTasks", client.rpc("get_my_published_video_tasks"), "student_id"],
    ["leaveRequests", client.rpc("list_my_session_leave_requests"), "student_id"],
  ];
  const rowsByProjection = {};
  for (const [name, promise, studentKey] of calls) {
    const rows = await requireRows(await promise, `${label}.${name}`);
    assertOnlyStudentIds(rows, allowedIds, `${label}.${name}`, studentKey);
    rowsByProjection[name] = rows.length;
  }
  return rowsByProjection;
}

async function requireRpcForbidden(result, label) {
  if (!result.error || !/FORBIDDEN/i.test(result.error.message)) {
    throw new Error(`${label} did not reject with FORBIDDEN`);
  }
  return { label, rejected: true };
}

async function requireDirectReadRejected(query, label) {
  const result = await query;
  if (result.error) return { label, mode: "error" };
  if ((result.data ?? []).length !== 0) throw new Error(`${label} exposed a foreign row`);
  return { label, mode: "empty" };
}

loadLocalEnv();
if (process.env.R1_DEV_TEST_FIXTURES !== "1") throw new Error("Set R1_DEV_TEST_FIXTURES=1 to run fixed-account boundary checks");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishableKey || !secretKey) throw new Error("Supabase development environment is required");
await assertPrivateDevelopmentTarget(url);

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const users = Object.fromEntries(await Promise.all(Object.entries(ACCOUNT_EMAILS).map(async ([name, email]) => [
  name,
  await findUserByEmail(admin, email),
])));
const { data: students, error: studentError } = await admin
  .from("students")
  .select("id,user_id")
  .in("user_id", [users.studentOne.id, users.studentTwo.id])
  .is("deleted_at", null);
if (studentError) throw studentError;
const studentOne = students.find((row) => row.user_id === users.studentOne.id);
const studentTwo = students.find((row) => row.user_id === users.studentTwo.id);
if (!studentOne || !studentTwo) throw new Error("Both fixed student profiles are required");

const { data: foreignEnrollments, error: enrollmentError } = await admin
  .from("enrollments")
  .select("classroom_id")
  .eq("student_id", studentTwo.id)
  .eq("status", "active");
if (enrollmentError) throw enrollmentError;
const foreignClassroomIds = [...new Set((foreignEnrollments ?? []).map((row) => row.classroom_id))];
if (foreignClassroomIds.length === 0) throw new Error("The second fixed student needs an active enrollment");
const { data: assignment, error: assignmentError } = await admin
  .from("assignments")
  .select("id")
  .in("classroom_id", foreignClassroomIds)
  .limit(1)
  .single();
if (assignmentError) throw assignmentError;

const password = readUnifiedTestPassword();
const clients = {
  studentOne: await createAuthenticatedClient(url, publishableKey, ACCOUNT_EMAILS.studentOne, password),
  studentTwo: await createAuthenticatedClient(url, publishableKey, ACCOUNT_EMAILS.studentTwo, password),
  parent: await createAuthenticatedClient(url, publishableKey, ACCOUNT_EMAILS.parent, password),
  unboundParent: await createAuthenticatedClient(url, publishableKey, ACCOUNT_EMAILS.unboundParent, password),
};

try {
  const projectionRows = {
    studentOne: await readProjectionSnapshot(clients.studentOne, new Set([studentOne.id]), "studentOne"),
    studentTwo: await readProjectionSnapshot(clients.studentTwo, new Set([studentTwo.id]), "studentTwo"),
    parent: await readProjectionSnapshot(clients.parent, new Set([studentOne.id, studentTwo.id]), "parent"),
    unboundParent: await readProjectionSnapshot(clients.unboundParent, new Set(), "unboundParent"),
  };
  if (projectionRows.studentOne.students !== 1 || projectionRows.studentTwo.students !== 1) {
    throw new Error("Each fixed student account must resolve exactly one student profile");
  }
  if (projectionRows.parent.students !== 2) throw new Error("The fixed parent must resolve exactly two child profiles");
  if (Object.values(projectionRows.unboundParent).some((count) => count !== 0)) {
    throw new Error("The unbound parent received family projection rows");
  }

  const rpcRejections = await Promise.all([
    requireRpcForbidden(await clients.studentOne.rpc("get_customer_assignment", {
      p_assignment_id: assignment.id,
      p_student_id: studentTwo.id,
    }), "studentOne.foreignAssignment"),
    requireRpcForbidden(await clients.studentOne.rpc("get_customer_submission", {
      p_assignment_id: assignment.id,
      p_student_id: studentTwo.id,
    }), "studentOne.foreignSubmission"),
    requireRpcForbidden(await clients.unboundParent.rpc("get_customer_assignment", {
      p_assignment_id: assignment.id,
      p_student_id: studentOne.id,
    }), "unboundParent.assignment"),
    requireRpcForbidden(await clients.unboundParent.rpc("get_customer_submission", {
      p_assignment_id: assignment.id,
      p_student_id: studentOne.id,
    }), "unboundParent.submission"),
  ]);
  const directReadRejections = await Promise.all([
    requireDirectReadRejected(clients.studentOne.from("students").select("id").eq("id", studentTwo.id), "studentOne.students"),
    requireDirectReadRejected(clients.studentOne.from("student_guardians").select("student_id").eq("student_id", studentTwo.id), "studentOne.guardians"),
    requireDirectReadRejected(clients.studentOne.from("submissions").select("id").eq("user_id", users.studentTwo.id), "studentOne.submissions"),
    requireDirectReadRejected(clients.studentOne.from("session_reviews").select("student_id").eq("student_id", studentTwo.id), "studentOne.reviews"),
    requireDirectReadRejected(clients.unboundParent.from("students").select("id").eq("id", studentOne.id), "unboundParent.students"),
    requireDirectReadRejected(clients.unboundParent.from("submissions").select("id").eq("user_id", users.studentOne.id), "unboundParent.submissions"),
  ]);

  console.log(JSON.stringify({
    result: "pass",
    projectionRows,
    negativeChecks: {
      attempted: rpcRejections.length + directReadRejections.length,
      rejected: rpcRejections.length + directReadRejections.length,
      rpc: rpcRejections,
      directReads: directReadRejections,
    },
  }, null, 2));
} finally {
  await Promise.all(Object.values(clients).map((client) => client.auth.signOut()));
}
