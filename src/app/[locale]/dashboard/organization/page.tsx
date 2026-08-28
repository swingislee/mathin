import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getOrganizationProfileV2 } from "@/features/school/organization-locations";
import { OrganizationProfileForm } from "@/features/school/OrganizationProfileForm";
import { requirePerm } from "@/lib/auth";

export default async function OrganizationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "organization.profile.manage");
  const [t, profile] = await Promise.all([
    getTranslations("school.organizationProfile"),
    getOrganizationProfileV2(),
  ]);

  return (
    <DashboardPage title={t("title")} description={t("intro")}>
      <OrganizationProfileForm profile={profile} />
    </DashboardPage>
  );
}
