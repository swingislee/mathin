import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  PublicClassRunShell,
  type PublicClassLiveMode,
} from "@/features/school/PublicClassRunShell";
import { getPublicClassWorkbench } from "@/features/school/public-class";
import { getPublicClassTeachingCourseware } from "@/features/school/public-class-teaching";
import { getMyPerms, requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_MODES = ["host", "assessment", "roster"] as const;

export default async function PublicClassRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; activityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, activityId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  if (!UUID_PATTERN.test(activityId)) notFound();
  const user = await requireUser(locale);
  const [permissions, data] = await Promise.all([
    getMyPerms(user.id),
    getPublicClassWorkbench(activityId),
  ]);
  if (!data) notFound();

  const presentationSegments = data.segments.filter((segment) => segment.kind !== "group_assessment");
  const assessmentSegment = data.segments.find((segment) => segment.kind === "group_assessment") ?? null;
  const assignedPresentation = presentationSegments.some((segment) => (
    segment.primaryTeacherId === user.id || segment.assistantTeacherId === user.id
  ));
  const assignedAssessment = Boolean(assessmentSegment && (
    assessmentSegment.primaryTeacherId === user.id || assessmentSegment.assistantTeacherId === user.id
  ));
  const assignedAny = assignedPresentation || assignedAssessment;
  const canView = assignedAny
    || permissions.has("activity.manage")
    || permissions.has("activity.register")
    || permissions.has("review.write");
  if (!canView) notFound();

  const program = await Promise.all(presentationSegments.map(async (segment) => ({
    segment,
    courseware: await getPublicClassTeachingCourseware(segment.id),
  })));
  const requestedMode = typeof query.mode === "string" && LIVE_MODES.includes(query.mode as PublicClassLiveMode)
    ? query.mode as PublicClassLiveMode
    : null;
  const roleDefault: PublicClassLiveMode = assignedAssessment && !assignedPresentation
    ? "assessment"
    : assignedPresentation || permissions.has("activity.manage")
      ? "host"
      : "roster";
  const defaultMode = requestedMode === "assessment" && !assessmentSegment
    ? roleDefault
    : requestedMode ?? roleDefault;

  return <PublicClassRunShell
    data={data}
    program={program}
    assessmentSegment={assessmentSegment}
    canTeach={assignedPresentation || permissions.has("activity.manage")}
    canRecord={assignedAny || permissions.has("activity.manage") || permissions.has("activity.register") || permissions.has("review.write")}
    locale={locale}
    defaultMode={defaultMode}
  />;
}
