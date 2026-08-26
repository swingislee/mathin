import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "../../scripts/lib/r1-write-target-policy.mjs";
import type { FixedAccount } from "./fixed-accounts";

type AdminClient = SupabaseClient;

interface FixtureState {
  classroomId?: string;
  sessionId?: string;
  className: string;
  sessionTitle: string;
}

export interface ClassroomContractFixture {
  classroomPath: `/zh/classroom/${string}/session/${string}/live`;
  cleanup: () => Promise<void>;
}

const DEVELOPMENT_CLASSROOM_BASELINE = [
  ["teaching.classroom_board_checkpoint_v2", true],
  ["teaching.classroom_input_v2", true],
  ["teaching.classroom_layout_v2", true],
  ["teaching.classroom_h5_pointer_v1", false],
] as const;

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

async function authenticateFixedAccount(
  url: string,
  publishableKey: string,
  account: FixedAccount,
  label: string,
) {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(account);
  if (error || !data.user) throw new Error(`Fixed ${label} account authentication failed`);
  return { client, userId: data.user.id };
}

async function assertExternalChannelsDisabled(admin: AdminClient) {
  const channels = ["email", "sms", "wechat", "webhook"];
  const rows = dataOrThrow<Array<{ channel: string; status: string }>>(
    await admin.from("integration_channels").select("channel,status").in("channel", channels),
    "read integration channel state",
  );
  const statusByChannel = new Map(rows.map((row) => [row.channel, row.status]));
  const unsafe = channels.filter((channel) => statusByChannel.get(channel) !== "disabled");
  if (unsafe.length > 0) throw new Error("Classroom contract E2E requires every external integration channel to be disabled");
}

async function reconcileDevelopmentBaseline(adminIdentity: Awaited<ReturnType<typeof authenticateFixedAccount>>) {
  for (const [flagKey, expected] of DEVELOPMENT_CLASSROOM_BASELINE) {
    const current = await adminIdentity.client.rpc("is_feature_enabled", {
      p_flag_key: flagKey,
      p_campus_id: null,
    });
    if (current.error) throw new Error(`read ${flagKey}: ${current.error.message}`);
    if (current.data === expected) continue;

    const updated = await adminIdentity.client.rpc("set_feature_flag", {
      p_flag_key: flagKey,
      p_campus_id: null,
      p_enabled: expected,
      p_effective_from: new Date().toISOString(),
      p_reason: "local classroom contract baseline",
    });
    if (updated.error) throw new Error(`reconcile ${flagKey}: ${updated.error.message}`);
  }
}

async function cleanupMutableFixture(admin: AdminClient, state: FixtureState) {
  if (!state.classroomId) return;
  const classroom = dataOrThrow<{ id: string; name: string; purpose: string; course_id: string | null } | null>(
    await admin
      .from("classrooms")
      .select("id,name,purpose,course_id")
      .eq("id", state.classroomId)
      .maybeSingle(),
    "verify classroom contract fixture",
  );
  if (!classroom) return;
  if (classroom.name !== state.className || classroom.purpose !== "test" || classroom.course_id !== null) {
    throw new Error("Classroom contract cleanup refused an unexpected classroom");
  }

  const sessions = dataOrThrow<Array<{ id: string; title: string }>>(
    await admin.from("class_sessions").select("id,title").eq("classroom_id", state.classroomId),
    "verify classroom contract sessions",
  );
  if (sessions.length !== 1
    || sessions[0]?.id !== state.sessionId
    || sessions[0]?.title !== state.sessionTitle) {
    throw new Error("Classroom contract cleanup refused an unexpected session set");
  }

  const { count: enrollmentCount, error: enrollmentError } = await admin
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("classroom_id", state.classroomId);
  if (enrollmentError) throw new Error(`verify classroom contract enrollments: ${enrollmentError.message}`);
  if (enrollmentCount !== 0) throw new Error("Classroom contract fixture unexpectedly contains enrollments");

  const { error: deleteError } = await admin.from("classrooms").delete().eq("id", state.classroomId);
  if (deleteError) throw new Error(`cleanup classroom contract fixture: ${deleteError.message}`);
  const { count, error } = await admin
    .from("classrooms")
    .select("id", { count: "exact", head: true })
    .eq("id", state.classroomId);
  if (error) throw new Error(`verify classroom contract cleanup: ${error.message}`);
  if (count !== 0) throw new Error("Classroom contract cleanup left a mutable classroom behind");
}

export async function setupClassroomContractFixture({
  adminAccount,
  teacher,
}: {
  adminAccount: FixedAccount;
  teacher: FixedAccount;
}): Promise<ClassroomContractFixture> {
  loadLocalEnv();
  if (process.env.R1_DEV_TEST_FIXTURES !== "1") {
    throw new Error("Set R1_DEV_TEST_FIXTURES=1 to run the local classroom contract");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) throw new Error("Local Supabase URL and keys are required");
  assertNonProductionWriteTarget({ operation: "e2e:classroom-contract", supabaseUrl: url });

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await assertExternalChannelsDisabled(admin);

  const token = randomBytes(5).toString("hex");
  const state: FixtureState = {
    className: `DEV-CLASSROOM-CONTRACT ${token} 测试班`,
    sessionTitle: `DEV-CLASSROOM-CONTRACT ${token} 课次`,
  };
  let cleaned = false;

  try {
    const [adminIdentity, teacherIdentity] = await Promise.all([
      authenticateFixedAccount(url, publishableKey, adminAccount, "admin"),
      authenticateFixedAccount(url, publishableKey, teacher, "teacher"),
    ]);
    await reconcileDevelopmentBaseline(adminIdentity);

    const teacherProfile = dataOrThrow<{ role: string; is_active: boolean }>(
      await admin.from("profiles").select("role,is_active").eq("id", teacherIdentity.userId).single(),
      "read fixed teacher profile",
    );
    if (!teacherProfile.is_active || !["staff", "admin"].includes(teacherProfile.role)) {
      throw new Error("Fixed teacher profile is not active staff");
    }
    const term = dataOrThrow<{ id: string }>(
      await admin.from("school_terms").select("id").eq("is_current", true).limit(1).single(),
      "read current school term",
    );

    const classroom = dataOrThrow<{ id: string }>(
      await admin.from("classrooms").insert({
        owner_id: teacherIdentity.userId,
        name: state.className,
        invite_code: `CC${token.slice(0, 6).toUpperCase()}`,
        course_id: null,
        term_id: term.id,
        purpose: "test",
        operational_status: "active",
      }).select("id").single(),
      "create classroom contract fixture",
    );
    state.classroomId = classroom.id;

    const membershipWrites = await Promise.all([
      admin.from("classroom_staff_assignments").insert({
        classroom_id: classroom.id,
        user_id: teacherIdentity.userId,
        responsibility: "primary_teacher",
        is_primary: false,
        created_by: adminIdentity.userId,
      }),
      admin.from("classroom_members").insert({
        classroom_id: classroom.id,
        user_id: teacherIdentity.userId,
        role: "teacher",
      }),
    ]);
    for (const result of membershipWrites) {
      if (result.error) throw new Error(`create classroom contract membership: ${result.error.message}`);
    }

    const boardPage = { id: randomUUID(), type: "board", title: "课堂合同白板" } as const;
    const session = dataOrThrow<{ id: string }>(
      await admin.from("class_sessions").insert({
        classroom_id: classroom.id,
        title: state.sessionTitle,
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        duration_min: 45,
        term_id: term.id,
        // Free sessions derive their effective pages from the overlay before
        // freezing. Writing only class_sessions.courseware would be discarded
        // by the authoritative template + overlay resolver at start time.
        courseware: [],
        courseware_overlay: [{ page: boardPage }],
      }).select("id").single(),
      "create classroom contract session",
    );
    state.sessionId = session.id;

    await Promise.all([
      adminIdentity.client.auth.signOut(),
      teacherIdentity.client.auth.signOut(),
    ]);

    return {
      classroomPath: `/zh/classroom/${classroom.id}/session/${session.id}/live`,
      cleanup: async () => {
        if (cleaned) return;
        await cleanupMutableFixture(admin, state);
        cleaned = true;
      },
    };
  } catch (error) {
    try {
      await cleanupMutableFixture(admin, state);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Classroom contract setup and cleanup both failed");
    }
    throw error;
  }
}
