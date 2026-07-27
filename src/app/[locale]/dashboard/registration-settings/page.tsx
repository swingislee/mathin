import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { RegistrationInvitePanel } from "@/features/school/RegistrationInvitePanel";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getRegistrationInviteSettings } from "@/features/school/registration";
import { requirePerm } from "@/lib/auth";

// doc22 §5.24：数据模型是一套组织级注册邀请设置（单例），不是邀请码集合，
// 因此既不叫 registration-invites，也没有 /new 或 /[inviteId]。
export default async function RegistrationSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
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
