import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom, getClassSession, listSessionBoardCheckpoints, listSessionEvents } from "@/features/classroom/actions";
import type { CoursewarePage } from "@/features/classroom/types";
import { LiveShell } from "@/features/classroom/live/LiveShell";
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
  searchParams: Promise<{ role?: string; mode?: string }>;
}) {
  const [{ locale, classId, sessionId }, { role: roleParam, mode }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  // 全量类型：P4-5 起晚加入者要还原板书快照/游戏镜像/视频进度/临时插页等一切基线
  const [classroom, session, events, boardCheckpoints, checkpointWriterEnabled] = await Promise.all([
    getClassroom(classId, sessionId),
    getClassSession(sessionId),
    listSessionEvents(sessionId),
    listSessionBoardCheckpoints(sessionId),
    isFeatureEnabled("teaching.classroom_board_checkpoint_v2"),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();

  // 教师进入未冻结课次时，试讲/候课都先用「模板+覆盖层」解析当前页面，
  // 与正式开课时冻结的结果保持一致（10-§5.4）。自由课次没有 lecture，
  // 其空模板 + 覆盖层就是教师为本课创建的完整课件。学生等待页仍保持空数组，
  // 直到正式开课后再读取冻结快照。
  let effectiveSession = session;
  if (classroom.myRole === "teacher" && !session.coursewareFrozenAt) {
    const template = session.lectureId ? await getSessionCoursewareTemplate(sessionId) : [];
    effectiveSession = {
      ...session,
      courseware: resolveCourseware(template, (session.coursewareOverlay as OverlaySlot[]) ?? []) as CoursewarePage[],
    };
  }

  // 试讲模式仅教师可用：本地临时事件流，不落库、不同步、不改课次状态
  const rehearsal = mode === "rehearsal" && classroom.myRole === "teacher";
  const offlineDrill = mode === "offline-drill" && classroom.myRole === "teacher";
  const attendanceSuggested = !rehearsal && !offlineDrill && classroom.myRole === "teacher" && !session.startedAt;
  const attendanceResult = attendanceSuggested ? await getAttendanceDrawerData(sessionId) : null;
  const initialAttendanceComplete = Boolean(
    attendanceResult?.ok && attendanceResult.data.length > 0 && attendanceResult.data.every((row) => row.marked),
  );
  const learningSetup = classroom.myRole === "teacher" ? await getSessionLearningSetup(sessionId) : null;
  const role = !rehearsal && roleParam === "display"
    ? "display"
    : classroom.myRole === "teacher"
      ? "control"
      : "viewer";

  return (
    <LiveShell
      session={effectiveSession}
      classId={classId}
      members={classroom.members}
      myRole={classroom.myRole}
      userId={user.id}
      initialEvents={events}
      initialCheckpoints={boardCheckpoints}
      checkpointV2Writer={checkpointWriterEnabled || (process.env.NODE_ENV !== "production" && rehearsal)}
      role={role}
      rehearsal={rehearsal}
      offlineDrill={offlineDrill}
      attendanceSuggested={attendanceSuggested}
      initialAttendanceComplete={initialAttendanceComplete}
      learningSetup={learningSetup}
    />
  );
}
