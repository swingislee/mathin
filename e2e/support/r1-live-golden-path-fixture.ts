import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "../../scripts/lib/r1-write-target-policy.mjs";
import type { FixedAccount } from "./fixed-accounts";

type AdminClient = SupabaseClient;

interface FixtureState {
  familyId?: string;
  catalogVersionId?: string;
  courseId?: string;
  lectureId?: string;
  studentId?: string;
  className: string;
}

export interface R1LiveGoldenPathFixture {
  className: string;
  courseTitle: string;
  lectureName: string;
  studentName: string;
  teacherDisplayName: string;
  termName: string;
  disableLessonConsumptionForTestClass: (classroomId: string) => Promise<void>;
  assertAttendancePersisted: (sessionId: string, status: "late", note: string) => Promise<void>;
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
  role: "principal" | "teacher",
): Promise<string> {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword(account);
  try {
    if (error || !data.user) throw new Error(`Fixed ${role} account authentication failed`);
    return data.user.id;
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function assertExternalChannelsDisabled(admin: AdminClient) {
  const channels = ["email", "sms", "wechat", "webhook"];
  const rows = dataOrThrow<Array<{ channel: string; status: string }>>(
    await admin.from("integration_channels").select("channel,status").in("channel", channels),
    "read integration channel state",
  );
  const statusByChannel = new Map(rows.map((row) => [row.channel, row.status]));
  const unsafe = channels.filter((channel) => statusByChannel.get(channel) !== "disabled");
  if (unsafe.length > 0) throw new Error("Golden Path requires every external integration channel to be disabled");
}

async function deleteById(admin: AdminClient, table: string, id: string | undefined) {
  if (!id) return;
  const { error } = await admin.from(table).delete().eq("id", id);
  if (error) throw new Error(`cleanup ${table}: ${error.message}`);
}

async function assertIdAbsent(admin: AdminClient, table: string, id: string | undefined) {
  if (!id) return;
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("id", id);
  if (error) throw new Error(`verify cleanup ${table}: ${error.message}`);
  if (count !== 0) throw new Error(`Golden Path cleanup left a mutable ${table} row behind`);
}

async function cleanupMutableFixture(admin: AdminClient, state: FixtureState) {
  let classroomRows: Array<{ id: string; name: string; purpose: string; course_id: string | null }> = [];
  let catalogVersionRows: Array<{ id: string }> = [];
  if (state.familyId) {
    catalogVersionRows = dataOrThrow(
      await admin.from("course_catalog_versions").select("id").eq("family_id", state.familyId),
      "locate Golden Path catalog version",
    );
    if (catalogVersionRows.length > 1
      || (state.catalogVersionId && catalogVersionRows.some((row) => row.id !== state.catalogVersionId))) {
      throw new Error("Golden Path cleanup refused an unexpected catalog version set");
    }
    state.catalogVersionId ??= catalogVersionRows[0]?.id;
  }
  if (state.courseId) {
    classroomRows = dataOrThrow(
      await admin.from("classrooms").select("id,name,purpose,course_id").eq("course_id", state.courseId),
      "locate Golden Path classrooms",
    );
    if (classroomRows.length > 1 || classroomRows.some((row) => row.name !== state.className || row.purpose !== "test")) {
      throw new Error("Golden Path cleanup refused an unexpected classroom set");
    }
  }

  if (state.studentId) {
    const { count, error } = await admin
      .from("lesson_ledger")
      .select("id", { count: "exact", head: true })
      .eq("student_id", state.studentId);
    if (error) throw new Error(`verify fixture lesson ledger: ${error.message}`);
    if (count !== 0) throw new Error("Golden Path unexpectedly produced immutable lesson ledger rows; cleanup stopped");
  }

  for (const classroom of classroomRows) {
    const { error } = await admin.from("classrooms").delete().eq("id", classroom.id);
    if (error) throw new Error(`cleanup classrooms: ${error.message}`);
    const { count, error: auditError } = await admin
      .from("domain_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "classroom.created")
      .eq("entity_id", classroom.id);
    if (auditError) throw new Error(`verify classroom audit: ${auditError.message}`);
    if (count !== 1) throw new Error("Golden Path expected exactly one retained classroom.created audit event");
  }

  await deleteById(admin, "students", state.studentId);
  await deleteById(admin, "courses", state.courseId);
  for (const catalogVersion of catalogVersionRows) {
    await deleteById(admin, "course_catalog_versions", catalogVersion.id);
  }
  await deleteById(admin, "course_families", state.familyId);

  await Promise.all([
    assertIdAbsent(admin, "students", state.studentId),
    assertIdAbsent(admin, "course_lectures", state.lectureId),
    assertIdAbsent(admin, "courses", state.courseId),
    assertIdAbsent(admin, "course_catalog_versions", state.catalogVersionId),
    assertIdAbsent(admin, "course_families", state.familyId),
  ]);
}

export async function setupR1LiveGoldenPathFixture({
  principal,
  teacher,
}: {
  principal: FixedAccount;
  teacher: FixedAccount;
}): Promise<R1LiveGoldenPathFixture> {
  loadLocalEnv();
  if (process.env.R1_DEV_TEST_FIXTURES !== "1") {
    throw new Error("Set R1_DEV_TEST_FIXTURES=1 to run the local write Golden Path");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) throw new Error("Local Supabase URL and keys are required");
  assertNonProductionWriteTarget({ operation: "e2e:r1-live:golden-path", supabaseUrl: url });

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await assertExternalChannelsDisabled(admin);

  const token = randomBytes(5).toString("hex");
  const className = `R1-Live GP ${token} 测试班`;
  const state: FixtureState = { className };
  let cleaned = false;

  try {
    const [principalId, teacherId] = await Promise.all([
      fixedAccountId(url, publishableKey, principal, "principal"),
      fixedAccountId(url, publishableKey, teacher, "teacher"),
    ]);
    const teacherProfile = dataOrThrow<{ display_name: string; role: string; is_active: boolean }>(
      await admin.from("profiles").select("display_name,role,is_active").eq("id", teacherId).single(),
      "read fixed teacher profile",
    );
    if (!teacherProfile.is_active || !["staff", "admin"].includes(teacherProfile.role)) {
      throw new Error("Fixed teacher profile is not active staff");
    }

    const currentTerm = dataOrThrow<{ id: string; name: string }>(
      await admin.from("school_terms").select("id,name").eq("is_current", true).limit(1).single(),
      "read current school term",
    );
    const courseTitle = `R1-Live GP ${token} 未完善课程`;
    const lectureName = `R1-Live GP ${token} 空白讲次`;
    const studentName = `R1-Live GP ${token} 学生`;
    const studentBindCode = Array.from(randomBytes(12), (byte) => String(byte % 10)).join("");

    const family = dataOrThrow<{ id: string }>(
      await admin.from("course_families").insert({
        slug: `r1-live-gp-${token}`,
        title: `R1-Live GP ${token} 课程族`,
        publisher: "Mathin local E2E",
        stage: "小学",
        subject: "数学",
        edition: "隔离测试",
        description: "R1-Live 本机隔离 Golden Path；执行后删除可变对象。",
        purpose: "test",
        status: "enabled",
        created_by: principalId,
      }).select("id").single(),
      "create Golden Path course family",
    );
    state.familyId = family.id;

    // course_families_seed_catalog_version 会为每个新课程族原子创建唯一的当前版本；
    // 夹具必须复用它，不能再插一条 is_current=true 与数据库合同竞争。
    const catalogVersion = dataOrThrow<{ id: string }>(
      await admin
        .from("course_catalog_versions")
        .select("id")
        .eq("family_id", family.id)
        .eq("is_current", true)
        .single(),
      "read seeded Golden Path catalog version",
    );
    state.catalogVersionId = catalogVersion.id;

    const course = dataOrThrow<{ id: string }>(
      await admin.from("courses").insert({
        family_id: family.id,
        catalog_version_id: catalogVersion.id,
        title: courseTitle,
        product_code: `R1GP-${token}`,
        grade: 1,
        term: 2,
        class_type: "A",
        purpose: "test",
        status: "enabled",
        term_id: currentTerm.id,
        created_by: principalId,
      }).select("id").single(),
      "create Golden Path course",
    );
    state.courseId = course.id;

    const lecture = dataOrThrow<{ id: string }>(
      await admin.from("course_lectures").insert({
        course_id: course.id,
        no: 1,
        name: lectureName,
        objectives: "验证未发布讲次仍可建班、排课并使用空白课堂。",
        status: "active",
      }).select("id").single(),
      "create incomplete Golden Path lecture",
    );
    state.lectureId = lecture.id;

    const student = dataOrThrow<{ id: string }>(
      await admin.from("students").insert({
        name: studentName,
        status: "lead",
        source: "r1-live-local-golden-path",
        remark: "本机隔离 E2E；无登录账号；执行后删除。",
        bind_code: studentBindCode,
        created_by: principalId,
      }).select("id").single(),
      "create Golden Path student record",
    );
    state.studentId = student.id;

    return {
      className,
      courseTitle,
      lectureName,
      studentName,
      teacherDisplayName: teacherProfile.display_name || teacherId.slice(0, 8),
      termName: currentTerm.name,
      disableLessonConsumptionForTestClass: async (classroomId) => {
        const classroom = dataOrThrow<{ id: string; name: string; purpose: string; course_id: string | null }>(
          await admin
            .from("classrooms")
            .select("id,name,purpose,course_id")
            .eq("id", classroomId)
            .single(),
          "verify Golden Path test classroom before disabling lesson consumption",
        );
        if (classroom.name !== className || classroom.purpose !== "test" || classroom.course_id !== course.id) {
          throw new Error("Golden Path refused to change the consume rule of an unexpected classroom");
        }
        const rows = dataOrThrow<Array<{ classroom_id: string }>>(
          await admin
            .from("consume_rules")
            .update({ present_lessons: 0, late_lessons: 0, absent_lessons: 0, leave_lessons: 0 })
            .eq("classroom_id", classroomId)
            .select("classroom_id"),
          "disable lesson consumption for Golden Path test classroom",
        );
        if (rows.length !== 1 || rows[0]?.classroom_id !== classroomId) {
          throw new Error("Golden Path expected exactly one test consume rule");
        }
      },
      assertAttendancePersisted: async (sessionId, status, note) => {
        const row = dataOrThrow<{ status: string; note: string; marked_by: string | null }>(
          await admin
            .from("session_attendance")
            .select("status,note,marked_by")
            .eq("session_id", sessionId)
            .eq("student_id", student.id)
            .single(),
          "read persisted attendance",
        );
        if (row.status !== status || row.note !== note || row.marked_by !== teacherId) {
          throw new Error("Persisted attendance does not match the teacher submission");
        }
      },
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
      throw new AggregateError([error, cleanupError], "Golden Path setup and cleanup both failed");
    }
    throw error;
  }
}
