import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getOrganizationProfileV2 } from "@/features/school/organization-locations";
import { OrganizationProfileForm } from "@/features/school/OrganizationProfileForm";
import { requirePerm } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { DashboardCommandPanel, DashboardCommandActions } from "@/features/school/dashboard-page";

export default async function OrganizationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "organization.profile.manage");
  const [t, profile] = await Promise.all([
    getTranslations("school.organizationProfile"),
    getOrganizationProfileV2(),
  ]);

  return (
    <DashboardPage title={t("title")} description={t("intro")} commandPanel={<DashboardCommandPanel><DashboardCommandActions><Link href="/dashboard/miniapp-runtime" className={buttonVariants({ variant: "secondary", size: "sm" })}>{locale === "en" ? "Mini Program" : "小程序"}</Link><Link href="/dashboard/organization/advisors" className={buttonVariants({ variant: "secondary", size: "sm" })}>{locale === "en" ? "Grade advisors" : "年级学服设置"}</Link></DashboardCommandActions></DashboardCommandPanel>}>
      <OrganizationProfileForm profile={profile} />
    </DashboardPage>
  );
}
