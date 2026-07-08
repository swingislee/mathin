import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom, getClassSession, listSessionEvents } from "@/features/classroom/actions";
import { LiveShell } from "@/features/classroom/live/LiveShell";
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

  // 试讲模式仅教师可用：本地临时事件流，不落库、不同步、不改课次状态
  const rehearsal = mode === "rehearsal" && classroom.myRole === "teacher";
  const role = !rehearsal && roleParam === "display"
    ? "display"
    : classroom.myRole === "teacher"
      ? "control"
      : "viewer";

  return (
    <LiveShell
      session={session}
      classId={classId}
      members={classroom.members}
      myRole={classroom.myRole}
      userId={user.id}
      initialEvents={events}
      role={role}
      rehearsal={rehearsal}
    />
  );
}
