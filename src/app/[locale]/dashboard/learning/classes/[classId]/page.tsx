import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CalendarDays, DoorOpen, UserRound } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { getClassroom, listAssignments, listClassSessions } from "@/features/classroom/actions";
import {
  DashboardAside,
  DashboardCard,
  DashboardContentGrid,
  DashboardMainColumn,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { getMyLearningCheckResults, getMyStudents } from "@/features/school/customer";
import { StudentLearningCheckResults } from "@/features/school/StudentLearningCheckResults";
import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LearningClassPage({ params }: {
  params: Promise<{ locale: string; classId: string }>;
}) {
  const { locale, classId } = await params;
  setRequestLocale(locale);
  await requireDashboardEnvironment(locale, ["learning"]);
  if (!UUID_PATTERN.test(classId)) notFound();

  const [t, tSessions, tAssignments, tStudents, classroom] = await Promise.all([
    getTranslations("classroom.home"),
    getTranslations("classroom.sessions"),
    getTranslations("classroom.assignments"),
    getTranslations("school.students"),
    getClassroom(classId),
  ]);
  if (!classroom) notFound();
  if (classroom.myRole === "teacher") redirect("/" + locale + "/dashboard/classes/" + classId);

  const [sessions, assignments, myStudents, learningChecks] = await Promise.all([
    listClassSessions(classId),
    listAssignments(classId),
    getMyStudents(),
    getMyLearningCheckResults({ classroomId: classId }),
  ]);
  const studentId = myStudents[0]?.id ?? null;
  const teacherName = classroom.members.find((member) => member.role === "teacher")?.displayName || t("anonymous");
  const upcoming = sessions
    .filter((session) => !session.endedAt)
    .sort((a, b) => (a.scheduledAt || a.createdAt).localeCompare(b.scheduledAt || b.createdAt));
  const history = sessions
    .filter((session) => session.endedAt)
    .sort((a, b) => (b.scheduledAt || b.createdAt).localeCompare(a.scheduledAt || a.createdAt));
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <DashboardPage
      title={classroom.name || t("untitled")}
      description={t("teacherName", { name: teacherName })}
      summary={
        <div className="flex items-center gap-2 text-sm text-muted">
          <UserRound size={15} aria-hidden="true" />
          <span>{t("myClass")}</span>
        </div>
      }
    >
      <DashboardContentGrid>
        <DashboardMainColumn className="space-y-6">
          <DashboardCard
            title={t("upcomingSessions")}
            actions={upcoming[0] ? (
              <Link
                href={"/classroom/" + classroom.id + "/session/" + upcoming[0].id}
                className={cn(buttonVariants({ size: "sm" }), "gap-2")}
              >
                <DoorOpen size={15} aria-hidden="true" />
                {upcoming[0].startedAt ? t("enterLiveClass") : t("openNextSession")}
              </Link>
            ) : undefined}
          >
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">{tSessions("empty")}</p>
            ) : (
              <ol className="divide-y divide-line">
                {upcoming.map((session) => (
                  <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
                    <time className="w-32 shrink-0 text-xs text-muted">
                      {session.scheduledAt ? format.format(new Date(session.scheduledAt)) : t("timePending")}
                    </time>
                    <Link
                      href={"/classroom/" + classroom.id + "/session/" + session.id}
                      className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                    >
                      {session.title || tSessions("untitled")}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </DashboardCard>

          <DashboardCard title={tStudents("learningChecksTitle")}>
            <p className="mb-4 text-xs text-muted">{tStudents("learningChecksIntro")}</p>
            <StudentLearningCheckResults locale={locale} records={learningChecks} showClassroom={false} />
          </DashboardCard>

          <DashboardCard title={t("classHistory")}>
            {history.length === 0 ? (
              <p className="text-sm text-muted">{t("historyEmpty")}</p>
            ) : (
              <ol className="max-h-80 divide-y divide-line overflow-y-auto">
                {history.map((session) => (
                  <li key={session.id} className="flex items-center gap-3 py-3">
                    <CalendarDays size={15} className="shrink-0 text-muted" aria-hidden="true" />
                    <time className="w-32 shrink-0 text-xs text-muted">
                      {session.scheduledAt ? format.format(new Date(session.scheduledAt)) : t("timePending")}
                    </time>
                    <span className="min-w-0 flex-1 truncate text-sm">{session.title || tSessions("untitled")}</span>
                  </li>
                ))}
              </ol>
            )}
          </DashboardCard>
        </DashboardMainColumn>

        <DashboardAside>
          <DashboardCard title={t("learningTasks")}>
            {assignments.length === 0 ? (
              <p className="text-sm text-muted">{tAssignments("empty")}</p>
            ) : (
              <ol className="divide-y divide-line">
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="py-3">
                    <Link
                      href={studentId
                        ? "/dashboard/assignments/" + assignment.id + "?student=" + studentId
                        : "/dashboard/assignments"}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {assignment.title || tAssignments("untitled")}
                    </Link>
                    <p className="mt-1 text-xs text-muted">
                      {assignment.dueAt ? tAssignments("due", { date: format.format(new Date(assignment.dueAt)) }) : tAssignments("noDue")}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <Link
              href="/dashboard/assignments"
              className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-4 w-full justify-center")}
            >
              {t("allLearningTasks")}
            </Link>
          </DashboardCard>
        </DashboardAside>
      </DashboardContentGrid>
    </DashboardPage>
  );
}