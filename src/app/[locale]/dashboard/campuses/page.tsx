import { getTranslations, setRequestLocale } from "next-intl/server";
import { CampusCreateDialog } from "@/features/school/CampusCreateDialog";
import { CampusList } from "@/features/school/CampusList";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { getLocationCatalogV2 } from "@/features/school/organization-locations";
import { requirePerm } from "@/lib/auth";

export default async function CampusesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "location.manage");
  const [t, campuses] = await Promise.all([
    getTranslations("school.locations"),
    getLocationCatalogV2(true),
  ]);

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={<DashboardCommandPanel><DashboardCommandActions><CampusCreateDialog /></DashboardCommandActions></DashboardCommandPanel>}
    >
      <CampusList campuses={campuses} />
    </DashboardPage>
  );
}
