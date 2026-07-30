import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BookOpen, CalendarDays, ClipboardList, DoorOpen, UserRound } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SectionShell } from "@/components/section-shell";
import { buttonVariants } from "@/components/ui/button";
import { getClassroom, listAssignments, listClassSessions } from "@/features/classroom/actions";
import { getMyStudents } from "@/features/school/customer";
import { Link } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClassroomHomePage({ params }: { params: Promise<{ locale: string; classId: string }> }) {
  const { locale, classId } = await params;
  setRequestLocale(locale);
  await requireUser(locale);
  if (!UUID_PATTERN.test(classId)) notFound();

  const [t, tSessions, tAssignments, classroom] = await Promise.all([
    getTranslations("classroom.home"),
    getTranslations("classroom.sessions"),
    getTranslations("classroom.assignments"),
    getClassroom(classId),
  ]);
  if (!classroom) notFound();
  if (classroom.myRole === "teacher") redirect("/" + locale + "/dashboard/classes/" + classId);

  const [sessions, assignments, myStudents] = await Promise.all([
    listClassSessions(classId),
    listAssignments(classId),
    getMyStudents(),
  ]);
  const studentId = myStudents[0]?.id ?? null;
  const teacherName = classroom.members.find((member) => member.role === "teacher")?.displayName || t("anonymous");
  const upcoming = sessions
    .filter((session) => !session.endedAt)
    .sort((a, b) => (a.scheduledAt || a.createdAt).localeCompare(b.scheduledAt || b.createdAt));
  const history = sessions
    .filter((session) => session.endedAt)
    .sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt));
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <SectionShell section="classroom" intro={t("studentHubIntro")} wide>
      <header className="flex flex-wrap items-start gap-4 border-b border-line pb-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{t("myClass")}</p>
          <h1 className="mt-1 truncate font-display text-2xl md:text-3xl">{classroom.name || t("untitled")}</h1>
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted"><UserRound size={15} />{t("teacherName", { name: teacherName })}</p>
        </div>
        {upcoming[0] && (
          <Link
            href={"/classroom/" + classroom.id + "/session/" + upcoming[0].id}
            className={cn(buttonVariants({ size: "sm" }), "gap-2")}
          >
            <DoorOpen size={15} />{upcoming[0].startedAt ? t("enterLiveClass") : t("openNextSession")}
          </Link>
        )}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <main className="min-w-0">
          <section>
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink"><CalendarDays size={16} />{t("upcomingSessions")}</h2>
            {upcoming.length === 0 ? (
              <EmptyState message={tSessions("empty")} />
            ) : (
              <ol className="mt-3 divide-y divide-line border-y border-line">
                {upcoming.map((session) => (
                  <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                    <time className="w-32 shrink-0 text-xs text-muted">
                      {session.scheduledAt ? fmt.format(new Date(session.scheduledAt)) : t("timePending")}
                    </time>
                    <Link href={"/classroom/" + classroom.id + "/session/" + session.id} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                      {session.title || tSessions("untitled")}
                    </Link>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", session.startedAt ? "bg-leaf/15 text-leaf-deep" : "bg-line/50 text-muted")}>
                      {session.startedAt ? tSessions("live") : tSessions("notStarted")}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="mt-8">
            <h2 className="flex items-center gap-2 text-sm font-medium text-ink"><BookOpen size={16} />{t("classHistory")}</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-muted">{t("historyEmpty")}</p>
            ) : (
              <ol className="mt-3 max-h-80 divide-y divide-line overflow-y-auto border-y border-line">
                {history.map((session) => (
                  <li key={session.id} className="flex items-center gap-3 py-3">
                    <time className="w-32 shrink-0 text-xs text-muted">
                      {session.scheduledAt ? fmt.format(new Date(session.scheduledAt)) : t("timePending")}
                    </time>
                    <span className="min-w-0 flex-1 truncate text-sm">{session.title || tSessions("untitled")}</span>
                    <span className="text-xs text-muted">{tSessions("ended")}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </main>

        <aside className="min-w-0 border-l-0 border-line lg:border-l lg:pl-5">
          <h2 className="flex items-center gap-2 text-sm font-medium text-ink"><ClipboardList size={16} />{t("learningTasks")}</h2>
          {assignments.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{tAssignments("empty")}</p>
          ) : (
            <ol className="mt-3 max-h-[32rem] divide-y divide-line overflow-y-auto">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="py-3">
                  <Link
                    href={studentId
                      ? "/dashboard/assignments/" + assignment.id + "?student=" + studentId
                      : "/classroom/" + classroom.id + "/assignment/" + assignment.id}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {assignment.title || tAssignments("untitled")}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    {assignment.dueAt ? tAssignments("due", { date: fmt.format(new Date(assignment.dueAt)) }) : tAssignments("noDue")}
                  </p>
                </li>
              ))}
            </ol>
          )}
          <Link href="/dashboard/assignments" className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-4 w-full justify-center")}>
            {t("allLearningTasks")}
          </Link>
        </aside>
      </div>
    </SectionShell>
  );
}