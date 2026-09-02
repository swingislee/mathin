import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { ActivityWorkspace } from "@/features/school/ActivityWorkspace";
import { ACTIVITY_WORKSPACE_NODES, type ActivityWorkspaceNode } from "@/features/school/activity-workflow-contract";
import { getActivity } from "@/features/school/activities";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { ObjectBar, ObjectWorkspace } from "@/features/school/object-workspace";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

const ACTIVITY_WORKSPACE_PERMISSIONS = ["activity.register", "review.write", "followup.view"] as const;

export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; activityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, activityId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requireAnyPerm(locale, ACTIVITY_WORKSPACE_PERMISSIONS);
  const permissions = await getMyPerms(user.id);
  const canViewRouting = permissions.has("followup.view");
  const [t, activity, timeZone] = await Promise.all([
    getTranslations("school.activities"),
    getActivity(activityId),
    getOrganizationTimezoneV2(),
  ]);
  if (!activity) notFound();
  const requestedNode = typeof query.node === "string" && ACTIVITY_WORKSPACE_NODES.includes(query.node as ActivityWorkspaceNode)
    ? query.node as ActivityWorkspaceNode
    : "participation";
  const activeNode = requestedNode === "routing" && !canViewRouting ? "participation" : requestedNode;

  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(activity.scheduledAt));

  return <ObjectWorkspace
    objectBar={<ObjectBar
      title={activity.title}
      backHref="/dashboard/activities"
      backLabel={t("backToActivities")}
      status={<Badge variant="outline">{t(`kind_${activity.kind}`)}</Badge>}
      context={[
        { label: t("time"), value: dateTime },
        { label: t("location"), value: activity.location || "—" },
        { label: t("duration"), value: activity.durationMin ? t("minutesValue", { minutes: activity.durationMin }) : "—" },
        { label: t("capacity"), value: activity.capacity ?? "∞" },
      ]}
    />}
  >
    <ActivityWorkspace
      activity={activity}
      activeNode={activeNode}
      canRegister={permissions.has("activity.register")}
      canAssess={permissions.has("activity.register") || permissions.has("review.write")}
      canViewRouting={canViewRouting}
      canRoute={permissions.has("followup.write")}
    />
  </ObjectWorkspace>;
}
