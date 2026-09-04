import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { TeacherTodaySessions } from "@/features/school/TeacherTodaySessions";
import { getTodaySessionOperations } from "@/features/school/teacher-session-operations";
import { getMyPerms, requireDashboardEnvironment } from "@/lib/auth";

export default async function SessionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const [t, data, perms] = await Promise.all([
    getTranslations("school.work"),
    getTodaySessionOperations(),
    getMyPerms(user.id),
  ]);
  const dateLabel = new Intl.DateTimeFormat(locale, { timeZone: data.timeZone, dateStyle: "full" }).format(new Date(data.fromIso));

  return (
    <DashboardPage
      title={t("todayTitle")}
      meta={<span>{dateLabel} · {data.timeZone}</span>}
      density="compact"
    >
      <TeacherTodaySessions
        sessions={data.sessions}
        timeZone={data.timeZone}
        locale={locale}
        canMarkAttendance={perms.has("attendance.mark")}
        returnTo="/dashboard/sessions"
      />
    </DashboardPage>
  );
}
