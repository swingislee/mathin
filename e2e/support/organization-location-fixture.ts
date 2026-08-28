import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "../../scripts/lib/r1-write-target-policy.mjs";
import type { FixedAccount } from "./fixed-accounts";

type AdminClient = SupabaseClient;

interface FixtureState {
  campusId?: string;
  classroomId?: string;
}

export interface LocationRoomState {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  status: "active" | "inactive";
}

export interface LocationSessionState {
  id: string;
  title: string;
  roomId: string | null;
  roomAssignmentOrigin: "class_default" | "session_override";
  cancelled: boolean;
}

export interface OrganizationLocationFixture {
  campusName: string;
  campusAddress: string;
  roomAName: string;
  roomBName: string;
  className: string;
  sessionNames: readonly [string, string, string];
  teacherDisplayName: string;
  trackCampus: (campusId: string) => void;
  trackClassroom: (classroomId: string) => void;
  readRooms: () => Promise<LocationRoomState[]>;
  readClassroomState: () => Promise<{
    defaultRoomId: string | null;
    sessions: LocationSessionState[];
  }>;
  cleanup: () => Promise<void>;
}

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
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

function dataOrThrow<T>(
  result: { data: T | null; error: { message: string } | null },
  operation: string,
): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${operation}: no data returned`);
  return result.data;
}

async function fixedAccountId(
  url: string,
  publishableKey: string,
  account: FixedAccount,
): Promise<string> {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(account);
  try {
    if (error || !data.user) throw new Error("Fixed teacher account authentication failed");
    return data.user.id;
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function findCampusId(admin: AdminClient, campusName: string) {
  const rows = dataOrThrow<Array<{ id: string; name: string }>>(
    await admin.from("campuses").select("id,name").eq("name", campusName),
    "locate organization-location campus",
  );
  if (rows.length > 1) throw new Error("Organization-location fixture found duplicate campuses");
  return rows[0]?.id;
}

async function findClassroomId(admin: AdminClient, className: string) {
  const rows = dataOrThrow<Array<{ id: string; name: string; purpose: string }>>(
    await admin.from("classrooms").select("id,name,purpose").eq("name", className),
    "locate organization-location classroom",
  );
  if (rows.length > 1 || rows.some((row) => row.purpose !== "test")) {
    throw new Error("Organization-location cleanup refused an unexpected classroom set");
  }
  return rows[0]?.id;
}

async function cleanupFixture(
  admin: AdminClient,
  state: FixtureState,
  expected: { campusName: string; roomNames: ReadonlySet<string>; className: string },
) {
  state.classroomId ??= await findClassroomId(admin, expected.className);
  if (state.classroomId) {
    const classroom = dataOrThrow<{ id: string; name: string; purpose: string }>(
      await admin.from("classrooms").select("id,name,purpose").eq("id", state.classroomId).single(),
      "verify organization-location classroom cleanup target",
    );
    if (classroom.name !== expected.className || classroom.purpose !== "test") {
      throw new Error("Organization-location cleanup refused a non-fixture classroom");
    }
    const { error } = await admin.from("classrooms").delete().eq("id", state.classroomId);
    if (error) throw new Error(`cleanup organization-location classroom: ${error.message}`);
  }

  state.campusId ??= await findCampusId(admin, expected.campusName);
  if (!state.campusId) return;

  const campus = dataOrThrow<{ id: string; name: string }>(
    await admin.from("campuses").select("id,name").eq("id", state.campusId).single(),
    "verify organization-location campus cleanup target",
  );
  if (campus.name !== expected.campusName) {
    throw new Error("Organization-location cleanup refused a non-fixture campus");
  }

  const holidayRows = dataOrThrow<Array<{ id: string }>>(
    await admin.from("school_holidays").select("id").eq("campus_id", state.campusId),
    "verify organization-location calendar cleanup boundary",
  );
  if (holidayRows.length > 0) {
    throw new Error("Organization-location cleanup found a campus calendar row and stopped");
  }

  const roomRows = dataOrThrow<Array<{ id: string; name: string }>>(
    await admin.from("campus_rooms").select("id,name").eq("campus_id", state.campusId),
    "locate organization-location rooms",
  );
  if (roomRows.length > expected.roomNames.size || roomRows.some((room) => !expected.roomNames.has(room.name))) {
    throw new Error("Organization-location cleanup refused an unexpected room set");
  }
  for (const room of roomRows) {
    const { error } = await admin.from("campus_rooms").delete().eq("id", room.id);
    if (error) throw new Error(`cleanup organization-location room: ${error.message}`);
  }
  const { error } = await admin.from("campuses").delete().eq("id", state.campusId);
  if (error) throw new Error(`cleanup organization-location campus: ${error.message}`);

  const [{ count: classroomCount, error: classroomError }, { count: campusCount, error: campusError }] = await Promise.all([
    admin.from("classrooms").select("id", { count: "exact", head: true }).eq("name", expected.className),
    admin.from("campuses").select("id", { count: "exact", head: true }).eq("name", expected.campusName),
  ]);
  if (classroomError || campusError) throw new Error("Could not verify organization-location fixture cleanup");
  if (classroomCount !== 0 || campusCount !== 0) {
    throw new Error("Organization-location fixture cleanup left mutable rows behind");
  }
}

export async function setupOrganizationLocationFixture({
  teacher,
}: {
  teacher: FixedAccount;
}): Promise<OrganizationLocationFixture> {
  loadLocalEnv();
  if (process.env.R1_DEV_TEST_FIXTURES !== "1") {
    throw new Error("Set R1_DEV_TEST_FIXTURES=1 to run the local organization-location journey");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) throw new Error("Local Supabase URL and keys are required");
  assertNonProductionWriteTarget({ operation: "e2e:organization-location", supabaseUrl: url });

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const teacherId = await fixedAccountId(url, publishableKey, teacher);
  const teacherProfile = dataOrThrow<{ display_name: string; role: string; is_active: boolean }>(
    await admin.from("profiles").select("display_name,role,is_active").eq("id", teacherId).single(),
    "read fixed teacher profile",
  );
  if (!teacherProfile.is_active || !["staff", "admin"].includes(teacherProfile.role)) {
    throw new Error("Fixed teacher profile is not active staff");
  }

  const token = randomBytes(5).toString("hex");
  const campusName = `E2E 星港 ${token}`;
  const campusAddress = `本机验收地址 ${token}`;
  const roomAName = `A 栋 201 · ${token}`;
  const roomBName = `B 栋 305 · ${token}`;
  const className = `E2E 场地闭环 ${token}`;
  const sessionNames = [
    `E2E 已取消覆盖课 ${token}`,
    `E2E 默认传播课 ${token}`,
    `E2E 显式待定课 ${token}`,
  ] as const;
  const state: FixtureState = {};
  const roomNames = new Set([roomAName, roomBName]);
  let cleaned = false;

  return {
    campusName,
    campusAddress,
    roomAName,
    roomBName,
    className,
    sessionNames,
    teacherDisplayName: teacherProfile.display_name,
    trackCampus: (campusId) => { state.campusId = campusId; },
    trackClassroom: (classroomId) => { state.classroomId = classroomId; },
    readRooms: async () => {
      state.campusId ??= await findCampusId(admin, campusName);
      if (!state.campusId) throw new Error("Fixture campus has not been created");
      const rows = dataOrThrow<Array<{
        id: string;
        name: string;
        code: string;
        capacity: number | null;
        status: "active" | "inactive";
      }>>(
        await admin.from("campus_rooms").select("id,name,code,capacity,status").eq("campus_id", state.campusId).order("name"),
        "read organization-location rooms",
      );
      if (rows.some((row) => !roomNames.has(row.name) || !row.code)) {
        throw new Error("Organization-location room rows did not match the fixture contract");
      }
      return rows;
    },
    readClassroomState: async () => {
      state.classroomId ??= await findClassroomId(admin, className);
      if (!state.classroomId) throw new Error("Fixture classroom has not been created");
      const classroom = dataOrThrow<{ default_room_id: string | null }>(
        await admin.from("classrooms").select("default_room_id").eq("id", state.classroomId).single(),
        "read organization-location classroom default",
      );
      const sessions = dataOrThrow<Array<{
        id: string;
        title: string;
        room_id: string | null;
        room_assignment_origin: "class_default" | "session_override";
        deleted_at: string | null;
        cancelled_by: string | null;
      }>>(
        await admin
          .from("class_sessions")
          .select("id,title,room_id,room_assignment_origin,deleted_at,cancelled_by")
          .eq("classroom_id", state.classroomId)
          .order("title"),
        "read organization-location sessions",
      );
      return {
        defaultRoomId: classroom.default_room_id,
        sessions: sessions.map((session) => ({
          id: session.id,
          title: session.title,
          roomId: session.room_id,
          roomAssignmentOrigin: session.room_assignment_origin,
          cancelled: Boolean(session.deleted_at || session.cancelled_by),
        })),
      };
    },
    cleanup: async () => {
      if (cleaned) return;
      await cleanupFixture(admin, state, { campusName, roomNames, className });
      cleaned = true;
    },
  };
}
