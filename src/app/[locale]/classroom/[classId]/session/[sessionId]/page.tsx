import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Play, Presentation } from "lucide-react";
import { SectionShell } from "@/components/section-shell";
import { getClassroom, getClassSession } from "@/features/classroom/actions";
import { CoursewareEditor } from "@/features/classroom/courseware/CoursewareEditor";
import { SessionTitleInput } from "@/features/classroom/SessionActions";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassSessionPage({
  params,
}: {
  params: Promise<{ locale: string; classId: string; sessionId: string }>;
}) {
  const { locale, classId, sessionId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId) || !UUID_PATTERN.test(sessionId)) notFound();

  const [t, classroom, session] = await Promise.all([
    getTranslations("classroom.session"),
    getClassroom(classId),
    getClassSession(sessionId),
  ]);
  if (!classroom || !session || session.classroomId !== classId) notFound();
  const isTeacher = classroom.myRole === "teacher";

  return (
    <SectionShell section="classroom" wide>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/classroom/${classId}`}
          aria-label={t("back")}
          className="rounded-full p-2 text-muted transition-colors hover:bg-moon/30 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          {isTeacher ? (
            <SessionTitleInput sessionId={session.id} initialTitle={session.title} />
          ) : (
            <h2 className="truncate font-display text-2xl md:text-3xl">{session.title || t("untitled")}</h2>
          )}
        </div>
        {isTeacher ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* 备课试讲：本地预演/复盘，不落库不同步；正式入口按课次状态给不同动词 */}
            <Link
              href={`/classroom/${classId}/session/${sessionId}/live?mode=rehearsal`}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:bg-moon/30 hover:text-ink"
            >
              <Presentation size={15} />
              {t("enterRehearsal")}
            </Link>
            <Link
              href={`/classroom/${classId}/session/${sessionId}/live`}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-85"
            >
              <Play size={15} />
              {!session.startedAt ? t("enterPrep") : !session.endedAt ? t("resume") : t("review")}
            </Link>
          </div>
        ) : (
          <Link
            href={`/classroom/${classId}/session/${sessionId}/live`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-85"
          >
            <Play size={15} />
            {t("enterLive")}
          </Link>
        )}
      </div>

      {isTeacher ? (
        <CoursewareEditor classroomId={classId} sessionId={session.id} initialPages={session.courseware} />
      ) : (
        <p className="mt-8 rounded-2xl border border-line px-5 py-6 text-sm text-muted">
          {t("studentHint", { count: session.courseware.length })}
        </p>
      )}
    </SectionShell>
  );
}
