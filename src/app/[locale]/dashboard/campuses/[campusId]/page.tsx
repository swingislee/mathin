import { getTranslations, setRequestLocale } from "next-intl/server";
import { CampusDetailManager } from "@/features/school/CampusDetailManager";
import { CampusRoomCreateDialog } from "@/features/school/CampusRoomCreateDialog";
import { DashboardCommandActions, DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { getCampusV2 } from "@/features/school/organization-locations";
import { requirePerm } from "@/lib/auth";

export default async function CampusDetailPage({
  params,
}: {
  params: Promise<{ locale: string; campusId: string }>;
}) {
  const { locale, campusId } = await params;
  setRequestLocale(locale);
  await requirePerm(locale, "location.manage");
  const [t, campus] = await Promise.all([
    getTranslations("school.locations"),
    getCampusV2(campusId),
  ]);

  return (
    <DashboardPage
      title={campus.name}
      description={t("detailIntro")}
      backHref="/dashboard/campuses"
      backLabel={t("backToCampuses")}
      commandPanel={<DashboardCommandPanel><DashboardCommandActions><CampusRoomCreateDialog campusId={campus.id} disabled={campus.status !== "active"} /></DashboardCommandActions></DashboardCommandPanel>}
    >
      <CampusDetailManager campus={campus} />
    </DashboardPage>
  );
}
