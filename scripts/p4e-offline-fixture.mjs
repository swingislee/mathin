import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

loadLocalEnv();
const fixtureFile = process.env.P4E_FIXTURE_FILE;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!fixtureFile || !url || !key) throw new Error("P4E_FIXTURE_FILE and Supabase server environment are required");
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function createFixture() {
  if (fs.existsSync(fixtureFile)) throw new Error("Fixture file already exists; clean it first");
  const suffix = crypto.randomBytes(6).toString("hex");
  const email = `p4e-offline-${suffix}@example.com`;
  const password = `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "P4E 离线演练教师" },
  });
  if (userError || !created.user) throw new Error(userError?.message ?? "Unable to create fixture user");
  const userId = created.user.id;
  try {
    const { error: profileError } = await admin.from("profiles").update({ role: "staff", display_name: "P4E 离线演练教师" }).eq("id", userId);
    if (profileError) throw profileError;
    const { data: classroom, error: classroomError } = await admin.from("classrooms").insert({
      owner_id: userId,
      name: "P4E 离线演练",
      invite_code: crypto.randomBytes(8).toString("hex"),
    }).select("id").single();
    if (classroomError || !classroom) throw classroomError ?? new Error("Unable to create classroom");
    const { error: memberError } = await admin.from("classroom_members").insert({ classroom_id: classroom.id, user_id: userId, role: "teacher" });
    if (memberError) throw memberError;
    const { data: session, error: sessionError } = await admin.from("class_sessions").insert({
      classroom_id: classroom.id,
      title: "P4E 十分钟断网演练",
      courseware: [
        { id: crypto.randomUUID(), type: "board", title: "离线页一" },
        { id: crypto.randomUUID(), type: "board", title: "离线页二" },
      ],
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (sessionError || !session) throw sessionError ?? new Error("Unable to create session");
    fs.writeFileSync(fixtureFile, JSON.stringify({ userId, email, password, classroomId: classroom.id, sessionId: session.id }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
}

async function cleanupFixture() {
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const { error } = await admin.auth.admin.deleteUser(fixture.userId);
  if (error) throw error;
  fs.unlinkSync(fixtureFile);
}

async function verifyFixture() {
  const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const { count, error } = await admin
    .from("session_events")
    .select("id", { count: "exact", head: true })
    .eq("session_id", fixture.sessionId);
  if (error) throw error;
  console.log(`P4E offline fixture stored events: ${count ?? 0}`);
}

const command = process.argv[2];
if (command === "create") await createFixture();
else if (command === "cleanup") await cleanupFixture();
else if (command === "verify") await verifyFixture();
else throw new Error("Usage: node scripts/p4e-offline-fixture.mjs <create|verify|cleanup>");
console.log(`P4E offline fixture ${command} complete`);
