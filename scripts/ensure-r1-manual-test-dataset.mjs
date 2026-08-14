/**
 * R1 学校系统人工验收清单 §1.2「最小业务数据集」的幂等准备脚本。
 *
 * 只创建带 `QA-<日期>-` 前缀、purpose=test 的对象，并复用 .claude/test-accounts.local.md
 * 里既有的 5+ 个固定账号；不新建任何 auth 用户，不改动 E 系列生产课程、release 与既有班级。
 * 课次生命周期（DATA-17）只落到 scheduled，其余状态由人工按清单线性推进，脚本不伪造。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";

const DATASET_ID = "QA-20260803-school-manual";
const QA = "QA-20260803";
const EXTERNAL_CHANNELS = ["email", "sms", "wechat", "webhook"];
const READONLY_SAMPLE_PRODUCT_CODE = "MFHK00621";

const ACTORS = {
  admin: "test-admin@mathin.local",
  principal: "test-principal@mathin.local",
  registrar: "test-registrar@mathin.local",
  research: "test-research@mathin.local",
  teacher: "test-teacher@mathin.local",
  sales: "test-sales@mathin.local",
  student: "test-student@mathin.local",
  studentB: "test-student-2@mathin.local",
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

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
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

async function resolveActors(admin) {
  const entries = await Promise.all(
    Object.entries(ACTORS).map(async ([key, email]) => [key, (await findUserByEmail(admin, email)).id]),
  );
  return Object.fromEntries(entries);
}

/** SAFE-05 / SAFE-10：财务关闭门与外部投递必须保持关闭，否则拒绝造数。 */
async function assertSafeEnvironment(admin) {
  const channels = unwrap(await admin.from("integration_channels").select("channel,status").in("channel", EXTERNAL_CHANNELS));
  const unsafe = channels.filter((row) => row.status !== "disabled").map((row) => row.channel);
  if (unsafe.length > 0) throw new Error(`External channels must stay disabled: ${unsafe.join(", ")}`);
  const { data: financeEnabled, error } = await admin.rpc("is_feature_enabled", { p_flag_key: "finance.enabled" });
  if (error) throw new Error(error.message);
  if (financeEnabled) throw new Error("finance.enabled must stay closed for the R1 manual acceptance dataset");
}

async function resolveCurrentTerm(admin) {
  const term = unwrap(await admin.from("school_terms").select("id,name,starts_on,ends_on").eq("is_current", true).maybeSingle());
  if (!term) throw new Error("An active school term is required");
  return term;
}

/** DATA-13：只读抽样，只断言不写入。 */
async function readProductionSample(admin) {
  const course = unwrap(await admin
    .from("courses")
    .select("id,title,product_code,family_id,purpose,status")
    .eq("product_code", READONLY_SAMPLE_PRODUCT_CODE)
    .single());
  if (course.purpose !== "production") throw new Error("The read-only sample must be a production course");
  const family = unwrap(await admin.from("course_families").select("id,title,slug,purpose").eq("id", course.family_id).single());
  const lecture = unwrap(await admin
    .from("course_lectures")
    .select("id,no,name,current_release_id")
    .eq("course_id", course.id)
    .eq("no", 1)
    .single());
  const releases = unwrap(await admin
    .from("cw_lecture_releases")
    .select("id,track,release_no")
    .eq("lecture_id", lecture.id)
    .order("release_no", { ascending: false }));
  const tracks = new Set(releases.map((row) => row.track));
  for (const track of ["native-16x9", "adapted-4x3"]) {
    if (!tracks.has(track)) throw new Error(`Read-only sample lecture is missing a ${track} release`);
  }
  return {
    family: { id: family.id, title: family.title, slug: family.slug },
    course: { id: course.id, title: course.title, productCode: course.product_code },
    lecture: { id: lecture.id, no: lecture.no, name: lecture.name, hasNativeHead: Boolean(lecture.current_release_id) },
    releases: releases.map((row) => ({ id: row.id, track: row.track, releaseNo: row.release_no })),
  };
}

/** DATA-14：本轮可改的测试课程产品 + 一个版本 + 两个讲次。 */
async function ensureTestCourse(admin, actors, term) {
  const slug = `${QA}-manual-acceptance`.toLowerCase();
  let family = unwrap(await admin.from("course_families").select("id,title,purpose,status").eq("slug", slug).maybeSingle());
  if (!family) {
    family = unwrap(await admin.from("course_families").insert({
      slug,
      title: `${QA}-人工验收课程`,
      publisher: "Mathin QA",
      stage: "小学",
      subject: "数学",
      edition: "验收版",
      description: "R1 学校后台人工验收专用测试课程产品，可自由改动，不得进入正式建班候选。",
      purpose: "test",
      status: "enabled",
      created_by: actors.research,
    }).select("id,title,purpose,status").single());
  }
  if (family.purpose !== "test") throw new Error("The QA course family must stay purpose=test");

  const productCode = `${QA}-A`;
  let course = unwrap(await admin
    .from("courses")
    .select("id,title,purpose,status,family_id")
    .eq("product_code", productCode)
    .maybeSingle());
  if (!course) {
    course = unwrap(await admin.from("courses").insert({
      family_id: family.id,
      title: `${QA}-人工验收课程·一年级暑期A`,
      product_code: productCode,
      grade: 1,
      term: 1,
      class_type: "A",
      purpose: "test",
      status: "enabled",
      term_id: term.id,
      created_by: actors.research,
    }).select("id,title,purpose,status,family_id").single());
  }
  if (course.purpose !== "test") throw new Error("The QA course version must stay purpose=test");

  const lectureSpecs = [
    { no: 1, name: `${QA}-第1讲 数与运算基础`, objectives: "认识 20 以内数的组成，完成不进位加法的口算。" },
    { no: 2, name: `${QA}-第2讲 图形认识入门`, objectives: "辨认长方形、正方形与三角形，完成图形分类。" },
  ];
  const lectures = [];
  for (const spec of lectureSpecs) {
    let lecture = unwrap(await admin
      .from("course_lectures")
      .select("id,no,name,status,current_release_id")
      .eq("course_id", course.id)
      .eq("no", spec.no)
      .maybeSingle());
    if (!lecture) {
      lecture = unwrap(await admin.from("course_lectures").insert({
        course_id: course.id,
        no: spec.no,
        name: spec.name,
        objectives: spec.objectives,
        status: "active",
      }).select("id,no,name,status,current_release_id").single());
    }
    lectures.push(lecture);
  }

  await ensureCourseStaff(admin, course.id, actors);
  return { family, course, lectures };
}

async function ensureCourseStaff(admin, courseId, actors) {
  const wanted = [
    { user_id: actors.research, responsibility: "owner" },
    { user_id: actors.teacher, responsibility: "editor" },
    { user_id: actors.principal, responsibility: "reviewer" },
  ];
  const existing = unwrap(await admin
    .from("course_staff_assignments")
    .select("id,user_id,responsibility")
    .eq("course_id", courseId)
    .is("archived_at", null));
  for (const row of wanted) {
    if (existing.some((item) => item.user_id === row.user_id && item.responsibility === row.responsibility)) continue;
    unwrap(await admin.from("course_staff_assignments").insert({
      user_id: row.user_id,
      scope_type: "variant",
      course_id: courseId,
      responsibility: row.responsibility,
      created_by: actors.principal,
    }).select("id").single());
  }
}

async function generateBindCode(admin) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = crypto.randomBytes(4).toString("hex");
    const existing = unwrap(await admin.from("students").select("id").eq("bind_code", code).maybeSingle());
    if (!existing) return code;
  }
  throw new Error("Unable to allocate a unique student bind code");
}

/** DATA-16：补齐「无账号 / 无监护人 / 历史报名」这一侧的测试学生。 */
async function ensureQaStudents(admin, actors) {
  const specs = [
    { name: `${QA}-学员甲·无账号无监护人`, status: "enrolled", follow_up_status: "signed", grade: 1 },
    { name: `${QA}-学员乙·历史报名`, status: "alumni", follow_up_status: "lost", grade: 1 },
  ];
  const students = [];
  for (const spec of specs) {
    let student = unwrap(await admin
      .from("students")
      .select("id,name,status,user_id")
      .eq("name", spec.name)
      .is("deleted_at", null)
      .maybeSingle());
    if (!student) {
      student = unwrap(await admin.from("students").insert({
        name: spec.name,
        grade: spec.grade,
        status: spec.status,
        follow_up_status: spec.follow_up_status,
        source: "QA 人工验收数据集",
        remark: `${DATASET_ID} 专用虚构档案，禁止填入真实未成年人信息。`,
        assigned_to: actors.sales,
        created_by: actors.registrar,
        bind_code: await generateBindCode(admin),
      }).select("id,name,status,user_id").single());
    }
    if (student.user_id) throw new Error(`QA student ${spec.name} must stay account-free`);
    const guardians = unwrap(await admin.from("student_guardians").select("student_id").eq("student_id", student.id));
    if (guardians.length > 0) throw new Error(`QA student ${spec.name} must stay guardian-free`);
    students.push(student);
  }
  return { unaccounted: students[0], historical: students[1] };
}

async function resolveAccountStudents(admin, actors) {
  const rows = unwrap(await admin
    .from("students")
    .select("id,name,user_id")
    .in("user_id", [actors.student, actors.studentB])
    .is("deleted_at", null));
  const byUser = new Map(rows.map((row) => [row.user_id, row]));
  const studentA = byUser.get(actors.student);
  const studentB = byUser.get(actors.studentB);
  if (!studentA || !studentB) throw new Error("Both fixed student accounts must have a student profile");
  return { studentA, studentB };
}

function inviteCode() {
  return crypto.randomBytes(4).toString("hex");
}

/** DATA-15：planning / active 两个测试班，各带主讲、学辅、学期、教室与课次。 */
async function ensureQaClass(admin, actors, term, course, { name, operationalStatus, room, capacity }) {
  let classroom = unwrap(await admin
    .from("classrooms")
    .select("id,name,purpose,operational_status,course_id,term_id,room,capacity,courseware_track,archived_at,trashed_at")
    .eq("name", name)
    .maybeSingle());
  if (!classroom) {
    classroom = unwrap(await admin.from("classrooms").insert({
      owner_id: actors.teacher,
      name,
      invite_code: inviteCode(),
      course_id: course.id,
      grade: 1,
      capacity,
      room,
      term_id: term.id,
      courseware_track: "native-16x9",
      purpose: "test",
      operational_status: operationalStatus,
    }).select("id,name,purpose,operational_status,course_id,term_id,room,capacity,courseware_track,archived_at,trashed_at").single());
  }
  if (classroom.purpose !== "test") throw new Error(`${name} must stay purpose=test`);
  if (classroom.trashed_at || classroom.archived_at) throw new Error(`${name} is archived or trashed and cannot be reused`);

  const staff = [
    // is_primary 只对 learning_support 有意义（classroom_staff_assignments_primary_only_support）。
    { user_id: actors.teacher, responsibility: "primary_teacher", is_primary: false },
    { user_id: actors.sales, responsibility: "learning_support", is_primary: true },
  ];
  const existingStaff = unwrap(await admin
    .from("classroom_staff_assignments")
    .select("user_id,responsibility")
    .eq("classroom_id", classroom.id));
  for (const row of staff) {
    if (existingStaff.some((item) => item.user_id === row.user_id && item.responsibility === row.responsibility)) continue;
    unwrap(await admin.from("classroom_staff_assignments").insert({
      classroom_id: classroom.id,
      user_id: row.user_id,
      responsibility: row.responsibility,
      is_primary: row.is_primary,
      created_by: actors.registrar,
    }).select("classroom_id").single());
  }
  unwrap(await admin.from("classroom_members").upsert({
    classroom_id: classroom.id,
    user_id: actors.teacher,
    role: "teacher",
  }, { onConflict: "classroom_id,user_id" }).select("classroom_id"));

  return classroom;
}

/** DATA-17 的起点：只落 scheduled，状态推进留给人工按 §6.4 / §7 线性执行。 */
async function ensureSessions(admin, classroom, lectures, specs) {
  const sessions = [];
  for (const spec of specs) {
    let session = unwrap(await admin
      .from("class_sessions")
      .select("id,title,scheduled_at,started_at,ended_at,deleted_at,cancelled_by,voided_at,lecture_id,lecture_no")
      .eq("classroom_id", classroom.id)
      .eq("title", spec.title)
      .maybeSingle());
    if (!session) {
      const lecture = lectures[spec.lectureIndex] ?? null;
      session = unwrap(await admin.from("class_sessions").insert({
        classroom_id: classroom.id,
        title: spec.title,
        courseware: [],
        scheduled_at: new Date(Date.now() + spec.daysFromNow * 86400000).toISOString(),
        duration_min: 90,
        lecture_id: lecture?.id ?? null,
        lecture_no: lecture?.no ?? null,
      }).select("id,title,scheduled_at,started_at,ended_at,deleted_at,cancelled_by,voided_at,lecture_id,lecture_no").single());
    }
    sessions.push(session);
  }
  return sessions;
}

async function ensureEnrollment(admin, classroomId, studentId, termId, { status, leftAt = null, operatedBy, remark }) {
  const existing = unwrap(await admin
    .from("enrollments")
    .select("id,status,left_at")
    .eq("classroom_id", classroomId)
    .eq("student_id", studentId));
  const match = existing.find((row) => (leftAt ? row.left_at !== null : row.left_at === null));
  if (match) return match;
  return unwrap(await admin.from("enrollments").insert({
    classroom_id: classroomId,
    student_id: studentId,
    status,
    left_at: leftAt,
    term_id: termId,
    operated_by: operatedBy,
    remark,
  }).select("id,status,left_at").single());
}

/** DATA-18：一个已发布作业 + 未提交 / 已提交未批改 / 已批改三种学生状态。 */
async function ensureAssignment(admin, actors, classroom, students) {
  const title = `${QA}-作业·提交三态样本`;
  let assignment = unwrap(await admin
    .from("assignments")
    .select("id,title,due_at")
    .eq("classroom_id", classroom.id)
    .eq("title", title)
    .maybeSingle());
  if (!assignment) {
    assignment = unwrap(await admin.from("assignments").insert({
      classroom_id: classroom.id,
      title,
      content: { text: "完成 20 以内加法练习 10 题，拍照或输入文字提交。仅用于 R1 人工验收。" },
      due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_by: actors.teacher,
    }).select("id,title,due_at").single());
  }

  const graded = await ensureSubmission(admin, assignment.id, students.studentA.user_id, {
    content: { text: `${QA} 已批改样本：10 题全部完成。` },
    score: 88,
    feedback: "计算准确，书写再工整一些。",
    gradedBy: actors.teacher,
  });
  const ungraded = await ensureSubmission(admin, assignment.id, students.studentB.user_id, {
    content: { text: `${QA} 已提交未批改样本：完成 8 题，剩余 2 题存疑。` },
  });
  return {
    assignment,
    graded: { submissionId: graded.id, studentId: students.studentA.id },
    submittedUngraded: { submissionId: ungraded.id, studentId: students.studentB.id },
    notSubmitted: { studentId: students.unaccounted.id, reason: "无账号学生，作业列表应显示未提交" },
  };
}

async function ensureSubmission(admin, assignmentId, userId, { content, score = null, feedback = "", gradedBy = null }) {
  const existing = unwrap(await admin
    .from("submissions")
    .select("id,score,graded_at")
    .eq("assignment_id", assignmentId)
    .eq("user_id", userId)
    .maybeSingle());
  if (existing) return existing;
  const now = new Date().toISOString();
  return unwrap(await admin.from("submissions").insert({
    assignment_id: assignmentId,
    user_id: userId,
    submitted_by: userId,
    content,
    submitted_at: now,
    score,
    feedback,
    graded_by: gradedBy,
    graded_at: gradedBy ? now : null,
  }).select("id,score,graded_at").single());
}

/**
 * DATA-19：一个视频任务 + 一个待审视频。
 * 挂在既有的已结束课次上，让「待审→审核」路径当轮就可验证；视频文件复制自既有测试上传，不引入新素材。
 */
async function ensureVideoFixture(admin, actors, students) {
  const taskTitle = `${QA}-视频任务·待审样本`;
  // 先认领上一轮已建的 QA 任务，否则第二次运行会因为「该课次已有任务」改选另一节课次而重复造数。
  let task = unwrap(await admin
    .from("session_video_tasks")
    .select("id,title,published_at,session_id")
    .eq("title", taskTitle)
    .maybeSingle());
  let target = task
    ? unwrap(await admin.from("class_sessions").select("id,title,classroom_id,ended_at").eq("id", task.session_id).single())
    : null;

  if (!target) {
    const endedSessions = unwrap(await admin
      .from("class_sessions")
      .select("id,title,classroom_id,ended_at")
      .not("ended_at", "is", null)
      .is("deleted_at", null)
      .is("voided_at", null)
      .order("ended_at", { ascending: false })
      .limit(20));
    const enrolledClassrooms = new Set(unwrap(await admin
      .from("enrollments")
      .select("classroom_id")
      .eq("student_id", students.studentA.id)
      .eq("status", "active")).map((row) => row.classroom_id));
    const taskedSessions = new Set(unwrap(await admin.from("session_video_tasks").select("session_id")).map((row) => row.session_id));
    target = endedSessions.find((row) => enrolledClassrooms.has(row.classroom_id) && !taskedSessions.has(row.id)) ?? null;
    if (!target) throw new Error("No ended session without a video task is available for the QA video fixture");
  }

  if (!task) {
    task = unwrap(await admin.from("session_video_tasks").insert({
      session_id: target.id,
      title: taskTitle,
      instructions: "录制 1 分钟讲题过程，用于 R1 人工验收的视频审核链路。",
      due_at: new Date(Date.now() + 5 * 86400000).toISOString(),
      published_by: actors.teacher,
      published_at: new Date().toISOString(),
    }).select("id,title,published_at,session_id").single());
  }

  const pendingNote = `${QA}-待审视频样本`;
  let video = unwrap(await admin
    .from("session_videos")
    .select("id,session_id,student_id,storage_path,submitted_at,reviewed_at,deleted_at")
    .eq("session_id", target.id)
    .eq("student_id", students.studentA.id)
    .eq("note", pendingNote)
    .is("deleted_at", null)
    .maybeSingle());
  if (!video) {
    const source = unwrap(await admin
      .from("session_videos")
      .select("id,storage_path,size_bytes,duration_sec")
      .is("deleted_at", null)
      .not("reviewed_at", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle());
    if (!source) throw new Error("A previously uploaded test video is required as the byte source");
    const videoId = crypto.randomUUID();
    const storagePath = `${target.classroom_id}/${target.id}/${videoId}.mp4`;
    const { error: copyError } = await admin.storage.from("session-videos").copy(source.storage_path, storagePath);
    if (copyError && !/exists/i.test(copyError.message)) throw new Error(copyError.message);
    video = unwrap(await admin.from("session_videos").insert({
      id: videoId,
      session_id: target.id,
      student_id: students.studentA.id,
      uploaded_by: students.studentA.user_id,
      storage_path: storagePath,
      size_bytes: source.size_bytes,
      duration_sec: source.duration_sec,
      note: pendingNote,
      video_task_id: task.id,
      submitted_at: new Date().toISOString(),
    }).select("id,session_id,student_id,storage_path,submitted_at,reviewed_at,deleted_at").single());
  }
  if (video.reviewed_at) throw new Error("The QA video fixture must stay pending review");
  return { session: { id: target.id, title: target.title }, task, video: { id: video.id, pending: true } };
}

/** DATA-20：只读盘点已有的成果链路周期，不新增成果。 */
async function readLearningResultCycle(admin, students, term) {
  const heads = unwrap(await admin
    .from("learning_result_heads")
    .select("id,kind,status,student_id,session_id,period_start,period_end,published_at")
    .eq("student_id", students.studentA.id)
    .eq("status", "published"));
  const kinds = new Set(heads.map((row) => row.kind));
  const missing = ["knowledge_summary", "session_review", "video_review", "stage_report"].filter((kind) => !kinds.has(kind));
  return {
    studentId: students.studentA.id,
    term: { id: term.id, name: term.name, startsOn: term.starts_on, endsOn: term.ends_on },
    publishedKinds: [...kinds].sort(),
    missingKinds: missing,
    heads: heads.map((row) => ({ id: row.id, kind: row.kind, sessionId: row.session_id, periodStart: row.period_start, periodEnd: row.period_end })),
  };
}

/** DATA-21：一次跨角色事件，同时产出 work item、审批与带 deep link 的站内通知。 */
async function ensureCrossRoleEvent(admin, actors, classroom) {
  const deepLink = `/dashboard/classes/${classroom.id}`;
  const workKey = `${DATASET_ID}:work-item`;
  let workItem = unwrap(await admin
    .from("work_items")
    .select("id,title,status,assignee_id,action_href")
    .eq("idempotency_key", workKey)
    .maybeSingle());
  if (!workItem) {
    workItem = unwrap(await admin.from("work_items").insert({
      source_kind: "manual",
      source_id: workKey,
      idempotency_key: workKey,
      domain: "teaching",
      title: `${QA}-跨角色事件·在读测试班待确认`,
      description: "R1 人工验收数据集：主管指派给教师的跨角色待办，用于验证 work item、通知与 deep link。",
      action_kind: "work_item.close",
      action_href: deepLink,
      assignee_id: actors.teacher,
      priority: "normal",
      status: "open",
      created_reason: "R1 学校后台人工验收 §1.2 DATA-21 预置",
      created_by: actors.principal,
    }).select("id,title,status,assignee_id,action_href").single());
  }

  const approvalKey = `${DATASET_ID}:approval`;
  let approval = unwrap(await admin
    .from("approval_requests")
    .select("id,title,status,requester_id,approver_id,action_href")
    .eq("idempotency_key", approvalKey)
    .maybeSingle());
  if (!approval) {
    approval = unwrap(await admin.from("approval_requests").insert({
      approval_kind: "general",
      subject_kind: "classroom",
      subject_id: classroom.id,
      idempotency_key: approvalKey,
      domain: "teaching",
      title: `${QA}-跨角色审批·测试班课次调整`,
      request_reason: "R1 人工验收数据集：教师向主管申请调整测试班课次安排。",
      payload: { datasetId: DATASET_ID, classroomId: classroom.id },
      action_href: deepLink,
      requester_id: actors.teacher,
      approver_id: actors.principal,
      priority: "normal",
      status: "pending",
    }).select("id,title,status,requester_id,approver_id,action_href").single());
  }

  const notificationKey = `domain_event:${DATASET_ID}`;
  let notification = unwrap(await admin
    .from("notifications")
    .select("id,notification_key,deep_link,recipient_id")
    .eq("recipient_id", actors.teacher)
    .contains("payload", { datasetId: DATASET_ID })
    .maybeSingle());
  if (!notification) {
    unwrap(await admin.from("domain_events").insert({
      actor_id: actors.principal,
      actor_role: "staff",
      target_user_id: actors.teacher,
      event_type: "classroom.staff.assigned",
      entity_type: "classroom",
      entity_id: classroom.id,
      payload: { datasetId: DATASET_ID, userId: actors.teacher, responsibility: "primary_teacher" },
      event_link: deepLink,
    }).select("id").single());
    notification = unwrap(await admin
      .from("notifications")
      .select("id,notification_key,deep_link,recipient_id")
      .eq("recipient_id", actors.teacher)
      .contains("payload", { datasetId: DATASET_ID })
      .maybeSingle());
  }
  void notificationKey;
  return { workItem, approval, notification };
}

/** DATA-22：只读盘点历史修复计划，财务关闭期间不得新增或执行。 */
async function readRepairAuditSamples(admin) {
  const plans = unwrap(await admin
    .from("data_repair_plans")
    .select("id,repair_key,repair_version,target_object_type,status,impact_count,created_at"));
  const financePlans = plans.filter((row) => /order|payment|refund|finance/i.test(`${row.repair_key} ${row.target_object_type}`));
  return {
    total: plans.length,
    plans: plans.map((row) => ({
      id: row.id,
      repairKey: row.repair_key,
      repairVersion: row.repair_version,
      targetObjectType: row.target_object_type,
      status: row.status,
      impactCount: row.impact_count,
    })),
    financeRelatedPlans: financePlans.length,
    note: "只读审计样本；财务关闭期间不新建、不执行、不 rollback。",
  };
}

loadLocalEnv();
if (process.env.R1_DEV_TEST_FIXTURES !== "1") throw new Error("Set R1_DEV_TEST_FIXTURES=1 to modify development fixtures");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
assertNonProductionWriteTarget({ operation: "r1:manual-dataset", supabaseUrl: url });
const key = process.env.SUPABASE_SECRET_KEY;
if (!key) throw new Error("SUPABASE_SECRET_KEY is required");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
await assertSafeEnvironment(admin);

const actors = await resolveActors(admin);
const term = await resolveCurrentTerm(admin);
const productionSample = await readProductionSample(admin);
const testCourse = await ensureTestCourse(admin, actors, term);
const qaStudents = await ensureQaStudents(admin, actors);
const accountStudents = await resolveAccountStudents(admin, actors);
const students = { ...accountStudents, ...qaStudents };

const planningClass = await ensureQaClass(admin, actors, term, testCourse.course, {
  name: `${QA}-筹备测试班`,
  operationalStatus: "planning",
  room: "QA-A101",
  capacity: 12,
});
const activeClass = await ensureQaClass(admin, actors, term, testCourse.course, {
  name: `${QA}-在读测试班`,
  operationalStatus: "active",
  room: "QA-A102",
  capacity: 12,
});

const planningSessions = await ensureSessions(admin, planningClass, testCourse.lectures, [
  { title: `${QA}-筹备课次1`, lectureIndex: 0, daysFromNow: 21 },
  { title: `${QA}-筹备课次2`, lectureIndex: 1, daysFromNow: 28 },
]);
const activeSessions = await ensureSessions(admin, activeClass, testCourse.lectures, [
  { title: `${QA}-在读课次1·生命周期主线`, lectureIndex: 0, daysFromNow: 1 },
  { title: `${QA}-在读课次2·调课代课`, lectureIndex: 1, daysFromNow: 3 },
  { title: `${QA}-在读课次3·取消恢复`, lectureIndex: 0, daysFromNow: 8 },
  { title: `${QA}-在读课次4·作废`, lectureIndex: 1, daysFromNow: 15 },
  { title: `${QA}-在读课次5·请假补课`, lectureIndex: 0, daysFromNow: 22 },
  { title: `${QA}-在读课次6·备用`, lectureIndex: 1, daysFromNow: 29 },
]);

const enrollments = {
  studentA: await ensureEnrollment(admin, activeClass.id, students.studentA.id, term.id, {
    status: "active", operatedBy: actors.registrar, remark: `${DATASET_ID} 在读·有账号有监护人`,
  }),
  studentB: await ensureEnrollment(admin, activeClass.id, students.studentB.id, term.id, {
    status: "active", operatedBy: actors.registrar, remark: `${DATASET_ID} 在读·有账号`,
  }),
  unaccounted: await ensureEnrollment(admin, activeClass.id, students.unaccounted.id, term.id, {
    status: "active", operatedBy: actors.registrar, remark: `${DATASET_ID} 在读·无账号无监护人`,
  }),
  historical: await ensureEnrollment(admin, activeClass.id, students.historical.id, term.id, {
    status: "completed",
    leftAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    operatedBy: actors.registrar,
    remark: `${DATASET_ID} 历史报名`,
  }),
};
for (const userId of [students.studentA.user_id, students.studentB.user_id]) {
  unwrap(await admin.from("classroom_members").upsert({
    classroom_id: activeClass.id,
    user_id: userId,
    role: "student",
  }, { onConflict: "classroom_id,user_id" }).select("classroom_id"));
}

const assignmentFixture = await ensureAssignment(admin, actors, activeClass, students);
const videoFixture = await ensureVideoFixture(admin, actors, students);
const learningResultCycle = await readLearningResultCycle(admin, students, term);
const crossRoleEvent = await ensureCrossRoleEvent(admin, actors, activeClass);
const repairAudit = await readRepairAuditSamples(admin);

console.log(JSON.stringify({
  datasetId: DATASET_ID,
  generatedAt: new Date().toISOString(),
  term: { id: term.id, name: term.name },
  "DATA-13_productionReadOnlySample": productionSample,
  "DATA-14_testCourse": {
    familyId: testCourse.family.id,
    courseId: testCourse.course.id,
    courseTitle: testCourse.course.title,
    lectures: testCourse.lectures.map((row) => ({ id: row.id, no: row.no, name: row.name, hasRelease: Boolean(row.current_release_id) })),
  },
  "DATA-15_classes": {
    planning: { id: planningClass.id, name: planningClass.name, room: planningClass.room, sessions: planningSessions.length },
    active: { id: activeClass.id, name: activeClass.name, room: activeClass.room, sessions: activeSessions.length },
    staff: { primaryTeacher: ACTORS.teacher, learningSupport: ACTORS.sales },
  },
  "DATA-16_students": {
    withAccountAndGuardian: { id: students.studentA.id, name: students.studentA.name },
    withAccount: { id: students.studentB.id, name: students.studentB.name },
    withoutAccountOrGuardian: { id: students.unaccounted.id, name: students.unaccounted.name },
    historicalEnrollment: { id: students.historical.id, name: students.historical.name, enrollmentStatus: enrollments.historical.status },
  },
  "DATA-17_sessions": {
    seededState: "scheduled",
    activeClassSessions: activeSessions.map((row) => ({ id: row.id, title: row.title, scheduledAt: row.scheduled_at })),
    planningClassSessions: planningSessions.map((row) => ({ id: row.id, title: row.title, scheduledAt: row.scheduled_at })),
    note: "ready / live / ended / post_pending / completed / cancelled / voided 由人工按 §6.4 与 §7 线性推进，脚本不写生命周期列。",
  },
  "DATA-18_assignment": assignmentFixture,
  "DATA-19_video": videoFixture,
  "DATA-20_learningResultCycle": learningResultCycle,
  "DATA-21_crossRoleEvent": crossRoleEvent,
  "DATA-22_repairAudit": repairAudit,
}, null, 2));
