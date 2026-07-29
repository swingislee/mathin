import { getTranslations, setRequestLocale } from "next-intl/server";
import { OrganizationSettingsPanel } from "@/features/school/OrganizationSettingsPanel";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getOrganizationSettings } from "@/features/school/organization-settings";
import { requirePerm } from "@/lib/auth";

export default async function OrganizationSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "organization.settings.manage");
  const [t, settings] = await Promise.all([getTranslations("school.organization"), getOrganizationSettings()]);

  return (
    <DashboardPage title={t("title")} description={t("intro")}>
      <OrganizationSettingsPanel key={settings.changeToken} initial={settings} />
    </DashboardPage>
  );
}
