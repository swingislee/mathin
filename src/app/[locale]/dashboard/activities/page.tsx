import { getTranslations, setRequestLocale } from "next-intl/server";
import { ActivitiesManager } from "@/features/school/ActivitiesManager";
import { listActivities } from "@/features/school/activities";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

const ACTIVITY_WORKSPACE_PERMISSIONS = ["activity.register", "review.write", "followup.view"] as const;

export default async function ActivitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ACTIVITY_WORKSPACE_PERMISSIONS);
  const [t, rows, permissions] = await Promise.all([
    getTranslations("school.activities"),
    listActivities(),
    getMyPerms(user.id),
  ]);
  return <ActivitiesManager
    title={t("title")}
    activities={rows}
    canManage={permissions.has("activity.manage")}
    canViewOpportunities={permissions.has("followup.view")}
  />;
}
