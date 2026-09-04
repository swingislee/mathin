import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DashboardPage } from "@/features/school/dashboard-page";
import { getPublicClassWorkbench } from "@/features/school/public-class";
import { MicrocourseEditor } from "@/features/teacher-microcourses/MicrocourseEditor";
import { getTeacherMicrocourseEditor } from "@/features/teacher-microcourses/data";
import { requirePerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PublicClassMicrocoursePage({
  params,
}: {
  params: Promise<{ locale: string; activityId: string; segmentId: string }>;
}) {
  const { locale, activityId, segmentId } = await params;
  setRequestLocale(locale);
  if (!UUID_PATTERN.test(activityId) || !UUID_PATTERN.test(segmentId)) notFound();
  await requirePerm(locale, "courseware.microcourse.author");
  const [t, data] = await Promise.all([
    getTranslations("school.publicClass"),
    getPublicClassWorkbench(activityId),
  ]);
  const segment = data?.segments.find((item) => item.id === segmentId);
  if (!data || !segment?.microcourseId) notFound();
  const editor = await getTeacherMicrocourseEditor(segment.microcourseId);
  if (!editor.canEdit || editor.originPublicClassSegmentId !== segment.id) notFound();
  const returnHref = `/dashboard/activities/${activityId}?view=arrangement`;

  return (
    <DashboardPage
      title={t("microcourseEditorTitle")}
      description={t("microcourseEditorDescription", { activity: data.activity.title, segment: segment.title })}
      backHref={returnHref}
      backLabel={t("backToArrangement")}
    >
      <MicrocourseEditor
        context={{
          title: `${data.activity.title} · ${segment.title}`,
          returnHref,
          badgeLabel: t("activityCoursewareBadge"),
          saveLabel: t("saveCoursewareAndReturn"),
        }}
        editor={editor}
        canTeach={false}
      />
    </DashboardPage>
  );
}
