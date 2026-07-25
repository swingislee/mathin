import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { RegistrationInvitePanel } from "@/features/school/RegistrationInvitePanel";
import { SchoolPageHeader } from "@/features/school/PageHeader";
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
    <div className="mx-auto w-full max-w-6xl">
      <SchoolPageHeader title={t("title")}>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t("intro")}</p>
      </SchoolPageHeader>
      <RegistrationInvitePanel initial={settings} updatedLabel={updatedLabel} />
    </div>
  );
}
