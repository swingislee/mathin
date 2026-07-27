import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { RegistrationInvitePanel } from "@/features/school/RegistrationInvitePanel";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getRegistrationInviteSettings } from "@/features/school/registration";
import { requirePerm } from "@/lib/auth";

export default async function RegistrationInvitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "registration.invite.manage");

  const [t, format, settings] = await Promise.all([
    getTranslations("school.registration"),
    getFormatter(),
    getRegistrationInviteSettings(),
  ]);
  const updatedLabel = t("updatedAt", {
    date: format.dateTime(new Date(settings.updatedAt), {
      dateStyle: "medium",
      timeStyle: "short",
    }),
  });

  return (
    <DashboardPage title={t("title")}>
      <RegistrationInvitePanel initial={settings} updatedLabel={updatedLabel} />
    </DashboardPage>
  );
}
