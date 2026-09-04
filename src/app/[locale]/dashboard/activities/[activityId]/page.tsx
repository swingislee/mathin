import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { ActivityWorkspace } from "@/features/school/ActivityWorkspace";
import { ACTIVITY_WORKSPACE_NODES, type ActivityWorkspaceNode } from "@/features/school/activity-workflow-contract";
import { getActivity } from "@/features/school/activities";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { ObjectBar, ObjectWorkspace } from "@/features/school/object-workspace";
import { PublicClassWorkspace } from "@/features/school/PublicClassWorkspace";
import {
  getPublicClassWorkbench,
  PUBLIC_CLASS_VIEWS,
  type PublicClassView,
} from "@/features/school/public-class";
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
  if (activity.kind === "public_class") {
    const publicClass = await getPublicClassWorkbench(activityId);
    if (!publicClass) notFound();
    const requestedView = typeof query.view === "string" ? query.view : "arrangement";
    const activeView: PublicClassView = PUBLIC_CLASS_VIEWS.includes(requestedView as PublicClassView)
      ? requestedView as PublicClassView
      : "arrangement";
    const requestedSegmentId = typeof query.segment === "string" ? query.segment : null;
    const activeSegmentId = publicClass.segments.some((segment) => segment.id === requestedSegmentId)
      ? requestedSegmentId
      : publicClass.segments[0]?.id ?? null;
    const assignedToSegment = publicClass.segments.some((segment) =>
      segment.primaryTeacherId === user.id || segment.assistantTeacherId === user.id
    );
    const canRecord = assignedToSegment
      || permissions.has("activity.manage")
      || permissions.has("activity.register")
      || permissions.has("review.write");
    const publicClassDateTime = new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(publicClass.activity.scheduledAt));
    return <ObjectWorkspace
      objectBar={<ObjectBar
        title={publicClass.activity.title}
        backHref="/dashboard/activities"
        backLabel={t("backToActivities")}
        status={<Badge variant="secondary">{t("kind_public_class")}</Badge>}
        context={[
          { label: t("time"), value: publicClassDateTime },
          { label: t("location"), value: publicClass.activity.location || "—" },
          { label: t("participation"), value: publicClass.participants.filter((participant) => participant.status !== "cancelled").length },
        ]}
      />}
    >
      <PublicClassWorkspace
        data={publicClass}
        locale={locale}
        activeView={activeView === "conversion" && !permissions.has("class.manage") ? "arrangement" : activeView}
        activeSegmentId={activeSegmentId}
        canManage={permissions.has("activity.manage")}
        canRecord={canRecord}
        canLinkClass={permissions.has("class.manage")}
        canUseCourseware={permissions.has("course.view") || permissions.has("courseware.microcourse.author")}
      />
    </ObjectWorkspace>;
  }
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
