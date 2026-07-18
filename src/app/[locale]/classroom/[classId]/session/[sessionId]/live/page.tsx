import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom, getClassSession, listSessionEvents } from "@/features/classroom/actions";
import type { CoursewarePage } from "@/features/classroom/types";
import { LiveShell } from "@/features/classroom/live/LiveShell";
import { getLectureCoursewareTemplate } from "@/features/school/courses";
import { resolveCourseware, type OverlaySlot } from "@/features/school/courseware-overlay";
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
  const [classroom, session, events] = await Promise.all([
    getClassroom(classId),
    getClassSession(sessionId),
    listSessionEvents(sessionId),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();

  // 挂讲次且未冻结的课次:courseware 要到开课才冻结落库,试讲/候课阶段
  // 用「模板+覆盖层」的同一套 resolve 先展示(与开课冻结结果一致,10-§5.4)。
  // 学生端 RLS 读不到讲次模板时保持空数组,行为同未开课等待页。
  let effectiveSession = session;
  if (session.lectureId && !session.coursewareFrozenAt) {
    const template = await getLectureCoursewareTemplate(session.lectureId);
    if (template.length > 0) {
      effectiveSession = {
        ...session,
        courseware: resolveCourseware(template, (session.coursewareOverlay as OverlaySlot[]) ?? []) as CoursewarePage[],
      };
    }
  }

  // 试讲模式仅教师可用：本地临时事件流，不落库、不同步、不改课次状态
  const rehearsal = mode === "rehearsal" && classroom.myRole === "teacher";
  const offlineDrill = mode === "offline-drill" && classroom.myRole === "teacher";
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
      role={role}
      rehearsal={rehearsal}
      offlineDrill={offlineDrill}
    />
  );
}
