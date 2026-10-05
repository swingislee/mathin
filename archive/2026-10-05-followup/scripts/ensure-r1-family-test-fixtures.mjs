import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";

const UNBOUND_PARENT_EMAIL = "test-parent-unbound@mathin.local";
const EXISTING_PARENT_EMAIL = "test-parent@mathin.local";
const SECOND_STUDENT_EMAIL = "test-student-2@mathin.local";
const GUARDIAN_SCOPES = ["finance", "grades", "video"];
const CONSENT_SCOPES = ["profile", "learning", "video"];

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
    if (data.users.length < 200) return null;
  }
  throw new Error(`Unable to exhaustively search test user ${email}`);
}

async function requireExistingUser(admin, email) {
  const user = await findUserByEmail(admin, email);
  if (!user) throw new Error(`Required existing test user is missing: ${email}`);
  return user;
}

async function getRegistrationMetadata(admin) {
  const { data, error } = await admin
    .from("registration_invite_settings")
    .select("code,is_active")
    .eq("id", 1)
    .single();
  if (error) throw error;
  if (!data.is_active || !data.code) throw new Error("An active development registration invite is required");
  return {
    display_name: "测试-未绑定家长",
    privacy_consent: "true",
    children_privacy_consent: "true",
    registration_invite_code: data.code,
  };
}

async function ensureUnboundParent(admin, password) {
  let user = await findUserByEmail(admin, UNBOUND_PARENT_EMAIL);
  let created = false;
  if (!user) {
    const userMetadata = await getRegistrationMetadata(admin);
    const { data, error } = await admin.auth.admin.createUser({
      email: UNBOUND_PARENT_EMAIL,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (error || !data.user) throw error ?? new Error("Unable to create unbound parent fixture");
    user = data.user;
    created = true;
  }

  const { error: credentialError } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (credentialError) throw credentialError;

  const now = new Date().toISOString();
  const { error: profileError } = await admin.from("profiles").update({
    role: "parent",
    display_name: "测试-未绑定家长",
    last_active_environment: "family",
    privacy_consented_at: now,
    children_privacy_consented_at: now,
  }).eq("id", user.id);
  if (profileError) throw profileError;

  const { count, error: relationError } = await admin
    .from("student_guardians")
    .select("student_id", { count: "exact", head: true })
    .eq("guardian_id", user.id);
  if (relationError) throw relationError;
  if ((count ?? 0) !== 0) throw new Error("Unbound parent fixture unexpectedly has a guardian relationship");

  await ensureAccountConsents(admin, user.id);
  return { id: user.id, created };
}

async function ensureAccountConsents(admin, userId) {
  const { data: policies, error: policyError } = await admin
    .from("consent_policies")
    .select("policy_kind,version")
    .eq("required", true);
  if (policyError) throw policyError;

  for (const policy of policies ?? []) {
    const { data: latest, error: latestError } = await admin
      .from("consent_records")
      .select("decision")
      .eq("subject_user_id", userId)
      .eq("policy_kind", policy.policy_kind)
      .eq("policy_version", policy.version)
      .eq("scope", "account")
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (latest?.decision === "granted") continue;
    const { error } = await admin.from("consent_records").insert({
      actor_user_id: userId,
      subject_user_id: userId,
      policy_kind: policy.policy_kind,
      policy_version: policy.version,
      scope: "account",
      decision: "granted",
      source: "migration",
    });
    if (error) throw error;
  }
}

async function ensureMultiChildRelationship(admin) {
  const [parent, studentUser] = await Promise.all([
    requireExistingUser(admin, EXISTING_PARENT_EMAIL),
    requireExistingUser(admin, SECOND_STUDENT_EMAIL),
  ]);
  const { data: student, error: studentError } = await admin
    .from("students")
    .select("id,name")
    .eq("user_id", studentUser.id)
    .single();
  if (studentError) throw studentError;

  const { error: relationshipError } = await admin.from("student_guardians").upsert({
    student_id: student.id,
    guardian_id: parent.id,
    relation: "妈妈（R1 多子女测试）",
    scope: GUARDIAN_SCOPES,
    is_primary: true,
  }, { onConflict: "student_id,guardian_id" });
  if (relationshipError) throw relationshipError;

  const { data: policy, error: policyError } = await admin
    .from("consent_policies")
    .select("version")
    .eq("policy_kind", "children_privacy")
    .eq("required", true)
    .single();
  if (policyError) throw policyError;

  for (const scope of CONSENT_SCOPES) {
    const { data: latest, error: latestError } = await admin
      .from("guardian_consents")
      .select("consented")
      .eq("student_id", student.id)
      .eq("guardian_id", parent.id)
      .eq("scope", scope)
      .order("consented_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw latestError;
    if (latest?.consented === true) continue;
    const { error: consentError } = await admin.from("guardian_consents").insert({
      student_id: student.id,
      guardian_id: parent.id,
      scope,
      consented: true,
    });
    if (consentError) throw consentError;
    const { error: recordError } = await admin.from("consent_records").insert({
      actor_user_id: parent.id,
      student_id: student.id,
      policy_kind: "children_privacy",
      policy_version: policy.version,
      scope,
      decision: "granted",
      source: "migration",
    });
    if (recordError) throw recordError;
  }
  return { parentId: parent.id, studentId: student.id, studentName: student.name };
}

loadLocalEnv();
if (process.env.R1_DEV_TEST_FIXTURES !== "1") throw new Error("Set R1_DEV_TEST_FIXTURES=1 to modify development fixtures");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
assertNonProductionWriteTarget({ operation: "r1:family-fixtures", supabaseUrl: url });
const key = process.env.SUPABASE_SECRET_KEY;
if (!key) throw new Error("SUPABASE_SECRET_KEY is required");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const unbound = await ensureUnboundParent(admin, readUnifiedTestPassword());
const multiChild = await ensureMultiChildRelationship(admin);
console.log(JSON.stringify({
  unboundParent: { id: unbound.id, email: UNBOUND_PARENT_EMAIL, created: unbound.created },
  multiChildParent: { id: multiChild.parentId, email: EXISTING_PARENT_EMAIL, childId: multiChild.studentId, childName: multiChild.studentName },
}, null, 2));
