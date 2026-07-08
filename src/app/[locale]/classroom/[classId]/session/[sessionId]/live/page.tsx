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
  searchParams: Promise<{ role?: string }>;
}) {
  const [{ locale, classId, sessionId }, { role: roleParam }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  const [classroom, session, events] = await Promise.all([
    getClassroom(classId),
    getClassSession(sessionId),
    listSessionEvents(sessionId, ["page", "star", "star_undo", "session_ctl"]),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();

  const role = roleParam === "display"
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
    />
  );
}
