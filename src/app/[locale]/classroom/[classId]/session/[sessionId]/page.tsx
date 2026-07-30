import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getClassroom, getClassSession } from "@/features/classroom/actions";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Legacy class-session entry. The staff preparation surface is canonical under
 * /dashboard/sessions/[sessionId]; students enter the same session's live room.
 */
export default async function ClassSessionPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; sessionId: string }>;
}) {
  const { locale, classId, sessionId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  const [classroom, session] = await Promise.all([
    getClassroom(classId),
    getClassSession(sessionId),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();

  if (classroom.myRole === "teacher") {
    const returnTo = encodeURIComponent(`/classroom/${classId}`);
    redirect(`/${locale}/dashboard/sessions/${sessionId}?stage=pre&returnTo=${returnTo}`);
  }
  redirect(`/${locale}/classroom/${classId}/session/${sessionId}/live`);
}
