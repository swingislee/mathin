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
import { getPublicClassTeachingCourseware } from "@/features/school/public-class-teaching";
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
    const assignedToSegment = publicClass.segments.some((segment) =>
      segment.primaryTeacherId === user.id || segment.assistantTeacherId === user.id
    );
    const assignedPresentation = publicClass.segments.some((segment) =>
      segment.kind !== "group_assessment"
      && (segment.primaryTeacherId === user.id || segment.assistantTeacherId === user.id)
    );
    const canManagePublicClass = permissions.has("activity.manage");
    const canRecord = assignedToSegment
      || canManagePublicClass
      || permissions.has("activity.register")
      || permissions.has("review.write");
    const defaultView: PublicClassView = assignedPresentation
      ? "teaching"
      : canRecord
        ? "onsite"
        : "review";
    const requestedView = typeof query.view === "string" ? query.view : defaultView;
    const legacyViewAliases: Record<string, PublicClassView> = {
      prepare: "teaching",
      arrangement: "onsite",
      roster: "live",
      print: "onsite",
      conversion: "review",
    };
    const normalizedView = legacyViewAliases[requestedView] ?? requestedView;
    let activeView: PublicClassView = PUBLIC_CLASS_VIEWS.includes(normalizedView as PublicClassView)
      ? normalizedView as PublicClassView
      : defaultView;
    if (activeView === "teaching" && !canRecord) activeView = "review";
    const requestedSegmentId = typeof query.segment === "string" ? query.segment : null;
    const activeSegmentId = publicClass.segments.some((segment) => segment.id === requestedSegmentId)
      ? requestedSegmentId
      : publicClass.segments[0]?.id ?? null;
    const teachingProgram = activeView === "teaching"
      ? await Promise.all(publicClass.segments
        .filter((segment) => segment.kind !== "group_assessment")
        .map(async (segment) => ({
          segment,
          courseware: await getPublicClassTeachingCourseware(segment.id),
        })))
      : [];
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
        teachingProgram={teachingProgram}
        locale={locale}
        activeView={activeView}
        activeSegmentId={activeSegmentId}
        canManage={canManagePublicClass}
        canRecord={canRecord}
        canLinkClass={permissions.has("class.manage")}
        canUseCourseware={canRecord && (permissions.has("course.view") || permissions.has("courseware.microcourse.author"))}
        canAuthorMicrocourse={canRecord && permissions.has("courseware.microcourse.author")}
        canPrepareTeaching={assignedPresentation || canManagePublicClass}
        currentUserId={user.id}
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
