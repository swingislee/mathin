import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AixuexiPageDoc } from "../../src/features/courseware-doc/aixuexi-schema";
import type { PageDoc } from "../../src/features/courseware-doc/schema";
import { assertNonProductionWriteTarget } from "../../scripts/lib/r1-write-target-policy.mjs";
import type { FixedAccount } from "./fixed-accounts";

type AdminClient = SupabaseClient;

interface FixtureState {
  sourceFamilyId?: string;
  sourceCourseId?: string;
  sourceLectureId?: string;
  sourceClassroomId?: string;
  sourceSessionId?: string;
  catalogClassroomId?: string;
  microcourseCourseId?: string;
}

export interface TeacherMicrocourseFixture {
  sourceSessionId: string;
  sourceClassroomId: string;
  nativePageTitle: string;
  aixuexiPageTitle: string;
  microcourseTitle: string;
  catalogClassName: string;
  teacherDisplayName: string;
  termName: string;
  registerCatalogClassroom: (classroomId: string) => void;
  assertPublishedCatalogClass: () => Promise<void>;
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
  if (unsafe.length > 0) throw new Error("Teacher microcourse E2E requires external integration channels to be disabled");
}

function nativeSourceDoc(token: string): PageDoc {
  return {
    docVersion: "page-doc-v1",
    sourceCoursewareId: `tmc-e2e-native-${token}`,
    sourcePageId: "native-1",
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: "1".repeat(64),
    canvas: {
      width: 1280,
      height: 720,
      backgroundColor: "#fffaf1",
      backgroundBindingKey: null,
    },
    nodes: [{
      id: "native-title",
      nodePath: "native-title",
      sourceType: "text",
      sourceResourceId: null,
      adapter: "text",
      name: "Native source title",
      supported: true,
      visible: true,
      interactive: false,
      zIndex: 1,
      order: 1,
      crop: null,
      transform: {
        x: 150, y: 210, width: 980, height: 180,
        rotation: 0, scaleX: 1, scaleY: 1,
        anchorX: 0, anchorY: 0, opacity: 1,
        flipX: false, flipY: false, clip: false,
      },
      style: {
        objectFit: "contain", backgroundColor: null, color: "#2d2a26",
        borderColor: null, borderWidth: 0, borderRadius: 0,
        fontFamily: null, fontSize: 54, fontWeight: 700,
        lineHeight: 1.3, letterSpacing: null, whiteSpace: "pre-wrap",
        textAlign: "center", overflow: "visible",
      },
      content: { kind: "text", text: "Native page · fixed release snapshot" },
      resources: [],
      children: [],
    }],
    interactions: [],
  };
}

function aixuexiSourceDoc(token: string): AixuexiPageDoc {
  return {
    docVersion: "aixuexi-page-doc-v1",
    adapter: "aixuexi-page-v1",
    projectionVersion: 31,
    source: {
      sourceSystem: "aixuexi_bsk",
      packageKey: `tmc-e2e-aixuexi-${token}`,
      coursewareId: `tmc-e2e-aixuexi-${token}`,
      pageDatabaseId: 2,
      sourceSnapshotId: 1,
      sourceContentHash: "2".repeat(64),
      pageName: "Aixuexi interaction base",
      groupName: "Teacher microcourse E2E",
    },
    canvas: {
      width: 1200,
      height: 900,
      widgetOffsetX: 0,
      slideClass: "light-slide slide",
      backgroundBindingKey: null,
    },
    playerStage: {
      width: 1920,
      height: 1080,
      presentationScale: 0.625,
      offsetX: 0,
      offsetY: 0,
      backgroundSize: "auto 1080px",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundColor: "#fffdf8",
      contentPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    presentation: {
      width: 1200,
      height: 675,
      contentScale: 0.75,
      offsetX: 150,
      offsetY: 0,
    },
    sourceRuntime: {
      runtimeBindingKey: "3".repeat(64),
      slideStylesheetPath: "slide-runtime.css",
      itvStylesheetPath: "itv-runtime.css",
      lottieRuntimePath: null,
      lottieRuntimeSha256: null,
      questionImageSizing: null,
      questionImageSizingInput: { imgs: {} },
    },
    behaviors: {
      splitQuestionScroll: null,
      singleQuestionScroll: null,
      stagedReveal: { underlineCount: 0, summaryWidgetCount: 0 },
      widgetReveal: { steps: 0 },
      shapeTextFit: null,
    },
    sourceKind: "inline_question",
    nodes: [{
      id: "aixuexi-question",
      sourcePath: "$.widgets[0]",
      sourceType: "question-stem",
      kind: "inline_question",
      title: "Aixuexi fixed interaction base",
      x: 120,
      y: 120,
      width: 960,
      height: 520,
      zIndex: 1,
      rotation: 0,
      transform: "",
      transformOrigin: "",
      known: true,
      html: "<section><h2>爱学习互动基底</h2><p>来源 release 已固定；教师仅编辑叠加层。</p></section>",
      resourceBindingKey: null,
      resourceBindingKeys: [],
      revealStep: 0,
      animations: [],
      questionTkRuntime: null,
      embeddedH5: null,
      trueOrFalse: null,
      topicClassification: null,
      warnings: [],
    }],
    topicInteraction: null,
    itvInteraction: null,
    behavior: { advanceOnCanvasClick: false },
    fourByThree: { mode: "source-player-compat", reasons: ["source_animation"] },
    warnings: [],
  };
}

async function deleteExactClassroom(
  admin: AdminClient,
  classroomId: string | undefined,
  expectedName: string,
  expectedCourseId?: string | null,
) {
  if (!classroomId) return;
  const result = await admin.from("classrooms").select("id,name,course_id").eq("id", classroomId).maybeSingle();
  if (result.error) throw new Error(`verify teacher microcourse fixture classroom: ${result.error.message}`);
  const row = result.data as { id: string; name: string; course_id: string | null } | null;
  if (!row) return;
  if (row.name !== expectedName || (expectedCourseId !== undefined && row.course_id !== expectedCourseId)) {
    throw new Error("Teacher microcourse cleanup refused an unexpected classroom");
  }
  const { error } = await admin.from("classrooms").delete().eq("id", classroomId);
  if (error) throw new Error(`cleanup classrooms: ${error.message}`);
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function purgeLocalTeacherMicrocourseProject({
  sourceSessionId,
  sourceSessionTitle,
  microcourseTitle,
}: {
  sourceSessionId: string;
  sourceSessionTitle: string;
  microcourseTitle: string;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(sourceSessionId)) throw new Error("Invalid local fixture session id");
  const container = process.env.SUPABASE_DB_CONTAINER?.trim() || "supabase-db";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error("Invalid local Supabase database container name");
  const sql = `
begin;
alter table public.teacher_microcourse_metadata_revisions disable trigger user;
alter table public.teacher_microcourse_review_snapshots disable trigger user;
alter table public.teacher_microcourse_page_sources disable trigger user;
alter table public.teacher_microcourse_h5_artifacts disable trigger user;
alter table public.teacher_microcourse_assets disable trigger user;
do $fixture$
declare
  v_project_id uuid;
  v_course_id uuid;
  v_course_kind text;
  v_course_title text;
  v_session_title text;
  v_shared_asset_ids uuid[];
  v_object_ids uuid[];
begin
  select project_row.id, project_row.course_id, course_row.course_kind, course_row.title, session_row.title
    into v_project_id, v_course_id, v_course_kind, v_course_title, v_session_title
    from public.teacher_microcourses project_row
    join public.courses course_row on course_row.id = project_row.course_id
    join public.class_sessions session_row on session_row.id = project_row.source_session_id
   where project_row.source_session_id = ${sqlLiteral(sourceSessionId)}::uuid
   for update of project_row;
  if not found then return; end if;
  if v_course_kind <> 'microcourse'
     or v_course_title <> ${sqlLiteral(microcourseTitle)}
     or v_session_title <> ${sqlLiteral(sourceSessionTitle)} then
    raise exception 'REFUSED_UNEXPECTED_TEACHER_MICROCOURSE_FIXTURE';
  end if;

  select coalesce(array_agg(shared_asset_id), '{}'::uuid[]), coalesce(array_agg(object_id), '{}'::uuid[])
    into v_shared_asset_ids, v_object_ids
    from public.teacher_microcourse_assets
   where microcourse_id = v_project_id;

  update public.teacher_microcourses
     set draft_metadata_revision_id = null,
         published_metadata_revision_id = null
   where id = v_project_id;
  delete from public.teacher_microcourse_review_snapshots where microcourse_id = v_project_id;
  delete from public.teacher_microcourse_page_sources where microcourse_id = v_project_id;
  delete from public.teacher_microcourse_h5_artifacts where microcourse_id = v_project_id;
  delete from public.teacher_microcourse_assets where microcourse_id = v_project_id;
  delete from public.teacher_microcourse_metadata_revisions where microcourse_id = v_project_id;
  delete from public.teacher_microcourses where id = v_project_id;
  delete from public.courses where id = v_course_id and course_kind = 'microcourse';
  delete from public.cw_shared_assets where id = any(v_shared_asset_ids);
  delete from public.cw_asset_objects object_row
   where object_row.id = any(v_object_ids)
     and not exists (
       select 1 from public.cw_asset_revisions revision_row
       where revision_row.object_id = object_row.id
     );
end
$fixture$;
alter table public.teacher_microcourse_assets enable trigger user;
alter table public.teacher_microcourse_h5_artifacts enable trigger user;
alter table public.teacher_microcourse_page_sources enable trigger user;
alter table public.teacher_microcourse_review_snapshots enable trigger user;
alter table public.teacher_microcourse_metadata_revisions enable trigger user;
commit;
`;
  const result = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, shell: false },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`cleanup local teacher microcourse project: ${result.error?.message ?? result.stderr.trim()}`);
  }
}

export async function setupTeacherMicrocourseFixture({
  adminAccount,
  principal,
  teacher,
}: {
  adminAccount: FixedAccount;
  principal: FixedAccount;
  teacher: FixedAccount;
}): Promise<TeacherMicrocourseFixture> {
  loadLocalEnv();
  if (process.env.R1_DEV_TEST_FIXTURES !== "1") {
    throw new Error("Set R1_DEV_TEST_FIXTURES=1 to run the local teacher microcourse journey");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) throw new Error("Local Supabase URL and keys are required");
  assertNonProductionWriteTarget({ operation: "e2e:teacher-microcourse", supabaseUrl: url });

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await assertExternalChannelsDisabled(admin);

  const token = randomBytes(5).toString("hex");
  const sourceClassName = `DEV-TMC-1 ${token} 自由班`;
  const sourceSessionTitle = `DEV-TMC-1 ${token} 自由课次`;
  const nativePageTitle = `DEV-TMC-1 ${token} 原生页`;
  const aixuexiPageTitle = `DEV-TMC-1 ${token} 爱学习页`;
  const microcourseTitle = `DEV-TMC-1 ${token} 教师微课`;
  const catalogClassName = `DEV-TMC-1 ${token} 目录建班`;
  const state: FixtureState = {};
  let cleaned = false;

  try {
    const [adminIdentity, principalIdentity, teacherIdentity] = await Promise.all([
      authenticateFixedAccount(url, publishableKey, adminAccount, "admin"),
      authenticateFixedAccount(url, publishableKey, principal, "principal"),
      authenticateFixedAccount(url, publishableKey, teacher, "teacher"),
    ]);
    const [flag, teacherProfile, currentTerm] = await Promise.all([
      adminIdentity.client.rpc("is_feature_enabled", {
        p_flag_key: "teaching.teacher_microcourses_v1",
        p_campus_id: null,
      }),
      admin.from("profiles").select("display_name,role,is_active").eq("id", teacherIdentity.userId).single(),
      admin.from("school_terms").select("id,name").eq("is_current", true).limit(1).single(),
    ]);
    if (flag.error) throw new Error(`read teacher microcourse feature flag: ${flag.error.message}`);
    if (flag.data !== true) {
      const enabled = await adminIdentity.client.rpc("set_feature_flag", {
        p_flag_key: "teaching.teacher_microcourses_v1",
        p_campus_id: null,
        p_enabled: true,
        p_effective_from: new Date().toISOString(),
        p_reason: "local DEV-TMC-1 Playwright acceptance",
      });
      if (enabled.error) throw new Error(`enable teacher microcourse feature flag: ${enabled.error.message}`);
    }
    const profile = dataOrThrow<{ display_name: string; role: string; is_active: boolean }>(teacherProfile, "read fixed teacher profile");
    const term = dataOrThrow<{ id: string; name: string }>(currentTerm, "read current school term");

    const family = dataOrThrow<{ id: string }>(
      await admin.from("course_families").insert({
        slug: `tmc-e2e-${token}`,
        title: `DEV-TMC-1 ${token} 来源课程族`,
        publisher: "Mathin local E2E",
        stage: "小学",
        subject: "数学",
        edition: "隔离测试",
        description: "Teacher microcourse source-page fixture.",
        purpose: "production",
        status: "enabled",
        created_by: principalIdentity.userId,
      }).select("id").single(),
      "create source course family",
    );
    state.sourceFamilyId = family.id;
    const catalogVersion = dataOrThrow<{ id: string }>(
      await admin.from("course_catalog_versions").select("id").eq("family_id", family.id).eq("is_current", true).single(),
      "read source catalog version",
    );
    const sourceCourse = dataOrThrow<{ id: string }>(
      await admin.from("courses").insert({
        family_id: family.id,
        catalog_version_id: catalogVersion.id,
        title: `DEV-TMC-1 ${token} 来源课程`,
        product_code: `TMC-${token}`,
        grade: 3,
        term: 2,
        class_type: "A",
        purpose: "production",
        status: "enabled",
        course_kind: "curriculum",
        term_id: term.id,
        created_by: principalIdentity.userId,
      }).select("id").single(),
      "create source course",
    );
    state.sourceCourseId = sourceCourse.id;
    const sourceLecture = dataOrThrow<{ id: string }>(
      await admin.from("course_lectures").insert({
        course_id: sourceCourse.id,
        no: 1,
        name: `DEV-TMC-1 ${token} 来源讲次`,
        objectives: "Native and Aixuexi source snapshot validation.",
        status: "active",
      }).select("id").single(),
      "create source lecture",
    );
    state.sourceLectureId = sourceLecture.id;
    const sourcePages = dataOrThrow<Array<{ id: string; page_no: number }>>(
      await admin.from("cw_page_docs").insert([{
        lecture_id: sourceLecture.id,
        page_no: 1,
        title: nativePageTitle,
        source_courseware_id: `tmc-e2e-${token}`,
        source_page_id: "native-1",
        doc_version: "page-doc-v1",
        aspect: "16:9",
      }, {
        lecture_id: sourceLecture.id,
        page_no: 2,
        title: aixuexiPageTitle,
        source_courseware_id: `tmc-e2e-${token}`,
        source_page_id: "aixuexi-2",
        doc_version: "aixuexi-page-doc-v1",
        aspect: "4:3",
      }]).select("id,page_no"),
      "create source page docs",
    );
    const pageByNo = new Map(sourcePages.map((page) => [page.page_no, page.id]));
    const nativePageId = pageByNo.get(1);
    const aixuexiPageId = pageByNo.get(2);
    if (!nativePageId || !aixuexiPageId) throw new Error("Source page identifiers were not returned");
    const revisions = dataOrThrow<Array<{ id: string; page_doc_id: string }>>(
      await admin.from("cw_page_revisions").insert([{
        page_doc_id: nativePageId,
        revision_no: 1,
        doc: nativeSourceDoc(token),
        doc_version: "page-doc-v1",
        layout_profile: "legacy-16x9-import",
        origin: "import",
        note: "Teacher microcourse E2E native source",
        created_by: principalIdentity.userId,
        track: "native-16x9",
      }, {
        page_doc_id: aixuexiPageId,
        revision_no: 1,
        doc: aixuexiSourceDoc(token),
        doc_version: "aixuexi-page-doc-v1",
        layout_profile: "legacy-16x9-import",
        origin: "import",
        note: "Teacher microcourse E2E Aixuexi source",
        created_by: principalIdentity.userId,
        track: "native-16x9",
      }]).select("id,page_doc_id"),
      "create source page revisions",
    );
    const revisionByPage = new Map(revisions.map((revision) => [revision.page_doc_id, revision.id]));
    const nativeRevisionId = revisionByPage.get(nativePageId);
    const aixuexiRevisionId = revisionByPage.get(aixuexiPageId);
    if (!nativeRevisionId || !aixuexiRevisionId) throw new Error("Source revision identifiers were not returned");
    for (const [pageId, revisionId] of [[nativePageId, nativeRevisionId], [aixuexiPageId, aixuexiRevisionId]]) {
      const { error } = await admin.from("cw_page_docs").update({ current_revision_id: revisionId }).eq("id", pageId);
      if (error) throw new Error(`pin source page revision: ${error.message}`);
    }
    const releaseSnapshot = [{
      pageDocId: nativePageId,
      revisionId: nativeRevisionId,
      bindings: [],
      learningCheckEnabled: false,
    }, {
      pageDocId: aixuexiPageId,
      revisionId: aixuexiRevisionId,
      bindings: [],
      learningCheckEnabled: false,
    }];
    const release = dataOrThrow<{ id: string }>(
      await admin.from("cw_lecture_releases").insert({
        lecture_id: sourceLecture.id,
        release_no: 1,
        note: "Teacher microcourse E2E source release",
        snapshot: releaseSnapshot,
        published_by: principalIdentity.userId,
        track: "native-16x9",
      }).select("id").single(),
      "publish source lecture fixture",
    );
    const { error: headError } = await admin.from("cw_lecture_track_heads").insert({
      lecture_id: sourceLecture.id,
      track: "native-16x9",
      current_release_id: release.id,
    });
    if (headError) throw new Error(`pin source track head: ${headError.message}`);

    const sourceClassroom = dataOrThrow<{ id: string }>(
      await admin.from("classrooms").insert({
        owner_id: teacherIdentity.userId,
        name: sourceClassName,
        invite_code: `TM${token.slice(0, 6).toUpperCase()}`,
        course_id: null,
        term_id: term.id,
        purpose: "production",
        operational_status: "active",
      }).select("id").single(),
      "create source free classroom",
    );
    state.sourceClassroomId = sourceClassroom.id;
    const membershipWrites = await Promise.all([
      admin.from("classroom_staff_assignments").insert({
        classroom_id: sourceClassroom.id,
        user_id: teacherIdentity.userId,
        responsibility: "primary_teacher",
        is_primary: false,
        created_by: principalIdentity.userId,
      }),
      admin.from("classroom_members").insert({
        classroom_id: sourceClassroom.id,
        user_id: teacherIdentity.userId,
        role: "teacher",
      }),
    ]);
    for (const result of membershipWrites) if (result.error) throw new Error(`create source classroom membership: ${result.error.message}`);
    const sourceSession = dataOrThrow<{ id: string }>(
      await admin.from("class_sessions").insert({
        classroom_id: sourceClassroom.id,
        title: sourceSessionTitle,
        scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        duration_min: 45,
        term_id: term.id,
        courseware: [],
        courseware_overlay: [],
      }).select("id").single(),
      "create source free session",
    );
    state.sourceSessionId = sourceSession.id;

    await Promise.all([
      adminIdentity.client.auth.signOut(),
      principalIdentity.client.auth.signOut(),
      teacherIdentity.client.auth.signOut(),
    ]);

    const cleanup = async () => {
      if (cleaned) return;
      const projectRows = state.sourceSessionId
        ? dataOrThrow<Array<{ id: string; course_id: string }>>(
            await admin.from("teacher_microcourses").select("id,course_id").eq("source_session_id", state.sourceSessionId),
            "locate teacher microcourse fixture project",
          )
        : [];
      if (projectRows.length > 1) throw new Error("Teacher microcourse cleanup found multiple projects for one fixture session");
      state.microcourseCourseId = projectRows[0]?.course_id;
      if (projectRows[0]) {
        const artifacts = dataOrThrow<Array<{ private_path: string; public_path: string | null }>>(
          await admin.from("teacher_microcourse_h5_artifacts").select("private_path,public_path").eq("microcourse_id", projectRows[0].id),
          "locate teacher microcourse H5 fixture artifacts",
        );
        const draftPaths = [...new Set(artifacts.map((artifact) => artifact.private_path))];
        const publicPaths = [...new Set(artifacts.flatMap((artifact) => artifact.public_path ? [artifact.public_path] : []))];
        if (draftPaths.length > 0) {
          const { error } = await admin.storage.from("cw-h5-drafts").remove(draftPaths);
          if (error) throw new Error(`cleanup teacher microcourse draft H5: ${error.message}`);
        }
        if (publicPaths.length > 0) {
          const references = dataOrThrow<Array<{ public_path: string | null }>>(
            await admin.from("teacher_microcourse_h5_artifacts").select("public_path").in("public_path", publicPaths).neq("microcourse_id", projectRows[0].id),
            "check shared published H5 fixture paths",
          );
          const sharedPaths = new Set(references.flatMap((artifact) => artifact.public_path ? [artifact.public_path] : []));
          const removablePaths = publicPaths.filter((publicPath) => !sharedPaths.has(publicPath));
          if (removablePaths.length > 0) {
            const { error } = await admin.storage.from("cw-h5").remove(removablePaths);
            if (error) throw new Error(`cleanup teacher microcourse published H5: ${error.message}`);
          }
        }
      }
      await deleteExactClassroom(admin, state.catalogClassroomId, catalogClassName, state.microcourseCourseId);
      if (projectRows[0]) purgeLocalTeacherMicrocourseProject({ sourceSessionId: state.sourceSessionId!, sourceSessionTitle, microcourseTitle });
      await deleteExactClassroom(admin, state.sourceClassroomId, sourceClassName, null);
      if (state.sourceCourseId) {
        const { error } = await admin.from("courses").delete().eq("id", state.sourceCourseId);
        if (error) throw new Error(`cleanup source course: ${error.message}`);
      }
      if (state.sourceFamilyId) {
        const { error: versionError } = await admin.from("course_catalog_versions").delete().eq("family_id", state.sourceFamilyId);
        if (versionError) throw new Error(`cleanup source catalog versions: ${versionError.message}`);
        const { error } = await admin.from("course_families").delete().eq("id", state.sourceFamilyId);
        if (error) throw new Error(`cleanup source family: ${error.message}`);
      }
      cleaned = true;
    };

    return {
      sourceSessionId: sourceSession.id,
      sourceClassroomId: sourceClassroom.id,
      nativePageTitle,
      aixuexiPageTitle,
      microcourseTitle,
      catalogClassName,
      teacherDisplayName: profile.display_name || teacherIdentity.userId.slice(0, 8),
      termName: term.name,
      registerCatalogClassroom: (classroomId) => { state.catalogClassroomId = classroomId; },
      assertPublishedCatalogClass: async () => {
        const projects = dataOrThrow<Array<{ id: string; course_id: string; lecture_id: string; published_metadata_revision_id: string | null }>>(
          await admin.from("teacher_microcourses").select("id,course_id,lecture_id,published_metadata_revision_id").eq("source_session_id", sourceSession.id),
          "read published teacher microcourse",
        );
        if (projects.length !== 1 || !projects[0]?.published_metadata_revision_id) {
          throw new Error("Teacher microcourse was not published atomically");
        }
        const lecture = dataOrThrow<{ current_release_id: string | null }>(
          await admin.from("course_lectures").select("current_release_id").eq("id", projects[0].lecture_id).single(),
          "read published teacher microcourse lecture",
        );
        if (!lecture.current_release_id) throw new Error("Teacher microcourse has no published release");
        state.microcourseCourseId = projects[0].course_id;
        if (!state.catalogClassroomId) throw new Error("Catalog classroom was not registered");
        const classroom = dataOrThrow<{ course_id: string | null; name: string }>(
          await admin.from("classrooms").select("course_id,name").eq("id", state.catalogClassroomId).single(),
          "read catalog-created classroom",
        );
        if (classroom.course_id !== projects[0].course_id || classroom.name !== catalogClassName) {
          throw new Error("Catalog class did not select the published teacher microcourse");
        }
        const sessions = dataOrThrow<Array<{ lecture_id: string | null }>>(
          await admin.from("class_sessions").select("lecture_id").eq("classroom_id", state.catalogClassroomId),
          "read catalog-created sessions",
        );
        if (sessions.length !== 1 || sessions[0]?.lecture_id !== projects[0].lecture_id) {
          throw new Error("A one-lecture teacher microcourse did not create exactly one session");
        }
      },
      cleanup,
    };
  } catch (error) {
    try {
      if (state.catalogClassroomId) await deleteExactClassroom(admin, state.catalogClassroomId, catalogClassName);
      if (state.sourceClassroomId) await deleteExactClassroom(admin, state.sourceClassroomId, sourceClassName, null);
      if (state.sourceCourseId) await admin.from("courses").delete().eq("id", state.sourceCourseId);
      if (state.sourceFamilyId) {
        await admin.from("course_catalog_versions").delete().eq("family_id", state.sourceFamilyId);
        await admin.from("course_families").delete().eq("id", state.sourceFamilyId);
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Teacher microcourse fixture setup and cleanup both failed");
    }
    throw error;
  }
}
