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
import { parseClassroomEntry } from "@/features/classroom/preparation/preparation-contract";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LiveClassPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; classId: string; sessionId: string }>;
  searchParams: Promise<{ role?: string; mode?: string; acceptance?: string; entry?: string }>;
}) {
  const [{ locale, classId, sessionId }, { role: roleParam, mode, acceptance, entry }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  const classroomTask = getClassroom(classId, sessionId, { includeInvite: false });
  const sessionTask = getClassSession(sessionId);
  const rosterTask = getSessionRoster(sessionId);
  const layoutTask = isFeatureEnabled("teaching.classroom_layout_v2");
  // 确认课次关系和教师身份后就读取课堂所需内容，不等待事件/板书基线或模板解析。
  const teachingTask = Promise.all([classroomTask, sessionTask, layoutTask]).then(async ([classroom, session, layoutV2Enabled]) => {
    if (!classroom || !session || session.classroomId !== classId) return null;
    const teacher = classroom.myRole === "teacher";
    const rehearsal = mode === "rehearsal" && teacher;
    const offlineDrill = mode === "offline-drill" && teacher;
    const attendanceSuggested = !rehearsal && !offlineDrill && teacher && !session.startedAt;
    const attendanceInLearningPanel = teacher && (layoutV2Enabled || (process.env.NODE_ENV !== "production" && rehearsal));
    const [template, attendanceResult, learningSetup] = await Promise.all([
      // 未冻结的教师课次解析模板+覆盖层；学生与已冻结课次保持原有快照规则。
      teacher && !session.coursewareFrozenAt ? getSessionCoursewareTemplate(sessionId) : Promise.resolve(null),
      attendanceSuggested || attendanceInLearningPanel ? getAttendanceDrawerData(sessionId) : Promise.resolve(null),
      teacher ? getSessionLearningSetup(sessionId, rosterTask) : Promise.resolve(null),
    ]);
    return {
      effectiveSession: template === null ? session : {
        ...session,
        courseware: resolveCourseware(template, (session.coursewareOverlay as OverlaySlot[]) ?? []) as CoursewarePage[],
      },
      rehearsal, offlineDrill, attendanceSuggested, attendanceResult, learningSetup,
    };
  });

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
    teaching,
  ] = await Promise.all([
    classroomTask,
    sessionTask,
    listSessionEvents(sessionId),
    listSessionBoardCheckpoints(sessionId),
    rosterTask,
    isFeatureEnabled("teaching.classroom_board_checkpoint_v2"),
    isFeatureEnabled("teaching.classroom_input_v2"),
    isFeatureEnabled("teaching.classroom_h5_pointer_v1"),
    layoutTask,
    teachingTask,
  ]);
  if (!classroom || !session || !teaching) notFound();
  const { effectiveSession, rehearsal, offlineDrill, attendanceSuggested, attendanceResult, learningSetup } = teaching;
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
          : acceptance === "m4b" ? "m4b" : null
      : null;

  return (
    <LiveShell
      key={`${sessionId}:${role}:${rehearsal}:${offlineDrill}`}
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
      entry={parseClassroomEntry(entry)}
      offlineDrill={offlineDrill}
      attendanceSuggested={attendanceSuggested}
      initialAttendanceComplete={initialAttendanceComplete}
      initialAttendanceRows={attendanceResult?.ok ? attendanceResult.data : []}
      learningSetup={learningSetup}
    />
  );
}
