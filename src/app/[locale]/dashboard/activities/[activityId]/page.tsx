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
  const canRegister = permissions.has("activity.register");
  const canAssess = permissions.has("review.write");
  const canViewOutcome = permissions.has("followup.view");
  const canOpenAssessmentSession = canAssess || canViewOutcome;
  const [t, activity, timeZone] = await Promise.all([
    getTranslations("school.activities"),
    getActivity(activityId),
    getOrganizationTimezoneV2(),
  ]);
  if (!activity) notFound();
  const requestedValue = query.node === "routing" ? "assessment" : query.node;
  const defaultNode: ActivityWorkspaceNode = canAssess && !canRegister ? "assessment" : "participation";
  const requestedNode = typeof requestedValue === "string" && ACTIVITY_WORKSPACE_NODES.includes(requestedValue as ActivityWorkspaceNode)
    ? requestedValue as ActivityWorkspaceNode
    : defaultNode;
  const activeNode = requestedNode === "assessment" && !canOpenAssessmentSession ? "participation" : requestedNode;

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
      canRegister={canRegister}
      canAssess={canAssess}
      canViewOutcome={canViewOutcome}
      canRecordOutcome={permissions.has("followup.write")}
    />
  </ObjectWorkspace>;
}
