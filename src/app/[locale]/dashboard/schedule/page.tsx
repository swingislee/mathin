import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { ScheduleWeekView } from "@/features/school/ScheduleWeekView";
import { getMyPerms, requireUser } from "@/lib/auth";

export default async function SchedulePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const [t, perms] = await Promise.all([getTranslations("school.schedule"), getMyPerms(user.id)]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      <div className="mt-6">
        <ScheduleWeekView canFilterTeacher={perms.has("schedule.view.all")} />
      </div>
    </div>
  );
}
