import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom, getClassSession, listSessionBoardCheckpoints, listSessionEvents } from "@/features/classroom/actions";
import type { CoursewarePage } from "@/features/classroom/types";
import { LiveShell } from "@/features/classroom/live/LiveShell";
import { getSessionRoster } from "@/features/classroom/roster-server";
import { getSessionCoursewareTemplate } from "@/features/school/courses";
import { getAttendanceDrawerData } from "@/features/school/actions/attendance";
import { getSessionLearningSetup } from "@/features/school/session-learning";
import { resolveCourseware, type OverlaySlot } from "@/features/school/courseware-overlay";
import { isFeatureEnabled } from "@/features/school/organization-settings";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LiveClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; classId: string; sessionId: string }>;
  searchParams: Promise<{ role?: string; mode?: string; acceptance?: string }>;
}) {
  const [{ locale, classId, sessionId }, { role: roleParam, mode, acceptance }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  // 全量类型：P4-5 起晚加入者要还原板书快照/游戏镜像/视频进度/临时插页等一切基线
  const [
    classroom,
    session,
    events,
    boardCheckpoints,
    rosterState,
    checkpointWriterEnabled,
    inputV2Enabled,
    h5PointerEnabled,
    layoutV2Enabled,
  ] = await Promise.all([
    getClassroom(classId, sessionId),
    getClassSession(sessionId),
    listSessionEvents(sessionId),
    listSessionBoardCheckpoints(sessionId),
    getSessionRoster(sessionId),
    isFeatureEnabled("teaching.classroom_board_checkpoint_v2"),
    isFeatureEnabled("teaching.classroom_input_v2"),
    isFeatureEnabled("teaching.classroom_h5_pointer_v1"),
    isFeatureEnabled("teaching.classroom_layout_v2"),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();

  // 教师进入未冻结课次时，试讲/候课都先用「模板+覆盖层」解析当前页面，
  // 与正式开课时冻结的结果保持一致（10-§5.4）。自由课次会由同一模板
  // RPC 投影当前“本节使用”的教师/教研方案；没有方案时才是空模板。
  // 学生等待页仍保持空数组，直到正式开课后再读取冻结快照。
  let effectiveSession = session;
  if (classroom.myRole === "teacher" && !session.coursewareFrozenAt) {
    const template = await getSessionCoursewareTemplate(sessionId);
    effectiveSession = {
      ...session,
      courseware: resolveCourseware(template, (session.coursewareOverlay as OverlaySlot[]) ?? []) as CoursewarePage[],
    };
  }

  // 试讲模式仅教师可用：本地临时事件流，不落库、不同步、不改课次状态
  const rehearsal = mode === "rehearsal" && classroom.myRole === "teacher";
  const offlineDrill = mode === "offline-drill" && classroom.myRole === "teacher";
  const attendanceSuggested = !rehearsal && !offlineDrill && classroom.myRole === "teacher" && !session.startedAt;
  const attendanceInLearningPanel = classroom.myRole === "teacher"
    && (layoutV2Enabled || (process.env.NODE_ENV !== "production" && rehearsal));
  const [attendanceResult, learningSetup] = await Promise.all([
    attendanceSuggested || attendanceInLearningPanel
      ? getAttendanceDrawerData(sessionId)
      : Promise.resolve(null),
    classroom.myRole === "teacher" ? getSessionLearningSetup(sessionId) : Promise.resolve(null),
  ]);
  const initialAttendanceComplete = Boolean(
    attendanceResult?.ok && attendanceResult.data.length > 0 && attendanceResult.data.every((row) => row.marked),
  );
  const role = roleParam === "display" && classroom.myRole === "teacher"
    ? "display"
    : classroom.myRole === "teacher"
      ? "control"
      : "viewer";
  // Acceptance fixtures are compiled out of production behavior; their runners
  // still require R1_DEV_TEST_FIXTURES before they may create local DB records.
  const developmentFixturesEnabled = process.env.NODE_ENV !== "production";
  const acceptanceFixture = developmentFixturesEnabled && acceptance === "interaction-sync" && !rehearsal
    ? "interaction-sync"
    : developmentFixturesEnabled && rehearsal
      ? acceptance === "m3b"
        ? "m3b"
        : acceptance === "m4a"
          ? "m4a"
          : "m4b"
      : null;

  return (
    <LiveShell
      session={effectiveSession}
      classId={classId}
      members={classroom.members}
      myRole={classroom.myRole}
      userId={user.id}
      initialEvents={events}
      initialCheckpoints={boardCheckpoints}
      initialRoster={rosterState}
      checkpointV2Writer={checkpointWriterEnabled || (process.env.NODE_ENV !== "production" && rehearsal)}
      inputV2Enabled={inputV2Enabled || (process.env.NODE_ENV !== "production" && rehearsal)}
      h5PointerEnabled={h5PointerEnabled || (process.env.NODE_ENV !== "production" && rehearsal)}
      layoutV2Enabled={layoutV2Enabled || (process.env.NODE_ENV !== "production" && rehearsal)}
      acceptanceFixture={acceptanceFixture}
      role={role}
      rehearsal={rehearsal}
      offlineDrill={offlineDrill}
      attendanceSuggested={attendanceSuggested}
      initialAttendanceComplete={initialAttendanceComplete}
      initialAttendanceRows={attendanceResult?.ok ? attendanceResult.data : []}
      learningSetup={learningSetup}
    />
  );
}
