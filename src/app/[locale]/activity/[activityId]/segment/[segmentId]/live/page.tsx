import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PublicClassTeachingShell } from "@/features/school/PublicClassTeachingShell";
import { getPublicClassWorkbench } from "@/features/school/public-class";
import { getPublicClassTeachingCourseware } from "@/features/school/public-class-teaching";
import { getMyPerms, requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublicClassLivePage({
  params,
}: {
  params: Promise<{ locale: string; activityId: string; segmentId: string }>;
}) {
  const { locale, activityId, segmentId } = await params;
  setRequestLocale(locale);
  if (!UUID_PATTERN.test(activityId) || !UUID_PATTERN.test(segmentId)) notFound();
  const user = await requireUser(locale);
  const [permissions, data] = await Promise.all([
    getMyPerms(user.id),
    getPublicClassWorkbench(activityId),
  ]);
  const segment = data?.segments.find((item) => item.id === segmentId);
  if (!data || !segment) notFound();
  const assigned = segment.primaryTeacherId === user.id || segment.assistantTeacherId === user.id;
  const canView = assigned
    || permissions.has("activity.manage")
    || permissions.has("activity.register")
    || permissions.has("review.write");
  if (!canView) notFound();
  const courseware = await getPublicClassTeachingCourseware(segmentId);

  return <PublicClassTeachingShell
    activity={data.activity}
    segment={segment}
    participants={data.participants}
    courseware={courseware}
    canTeach={assigned || permissions.has("activity.manage")}
    locale={locale}
  />;
}
