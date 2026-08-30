import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MicrocourseEditor } from "@/features/teacher-microcourses/MicrocourseEditor";
import { MicrocourseStartPanel } from "@/features/teacher-microcourses/MicrocourseStartPanel";
import { MicrocourseVariantPreview } from "@/features/teacher-microcourses/MicrocourseVariantPreview";
import { MicrocourseVariantSwitcher } from "@/features/teacher-microcourses/MicrocourseVariantSwitcher";
import {
  getTeacherMicrocourseEditor,
  getTeacherMicrocourseSessionContext,
  listTeacherMicrocourseVariants,
  listTeacherMicrocourseTopics,
} from "@/features/teacher-microcourses/data";
import { DashboardPage } from "@/features/school/dashboard-page";
import { isFeatureEnabled } from "@/features/school/organization-settings";
import { requirePerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TeacherMicrocoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const { locale, sessionId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("teacherMicrocourses");
  return (
    <DashboardPage
      title={t("pageTitle")}
      backHref={`/dashboard/sessions/${sessionId}?stage=pre`}
      backLabel={t("backToSession")}
    >
      <Suspense fallback={<div className="h-[42rem] animate-pulse border-y border-line bg-paper/30" />}>
        <TeacherMicrocourseContent locale={locale} sessionId={sessionId} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function TeacherMicrocourseContent({
  locale,
  sessionId,
  searchParams,
}: {
  locale: string;
  sessionId: string;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  if (!UUID_PATTERN.test(sessionId)) notFound();
  await requirePerm(locale, "courseware.microcourse.author");
  const [t, enabled, session, query] = await Promise.all([
    getTranslations("teacherMicrocourses"),
    isFeatureEnabled("teaching.teacher_microcourses_v1"),
    getTeacherMicrocourseSessionContext(sessionId),
    searchParams,
  ]);
  if (!session || session.lectureId !== null) notFound();
  if (!enabled) {
    return <section className="max-w-2xl border-y border-line py-5"><h2 className="text-base font-medium">{t("featureDisabledTitle")}</h2><p className="mt-1 text-sm text-muted">{t("featureDisabledDescription")}</p><p className="mt-4 text-sm text-muted">{t("featureDisabledHint")}</p></section>;
  }
  const [variants, topics] = await Promise.all([
    listTeacherMicrocourseVariants(sessionId),
    listTeacherMicrocourseTopics(),
  ]);
  if (variants.length === 0 && !session.canCreate) notFound();
  if (variants.length === 0) return <MicrocourseStartPanel sessionId={sessionId} sessionTitle={session.title} topics={topics} />;
  const requested = Array.isArray(query.variant) ? query.variant[0] : query.variant;
  const activeVariant = variants.find((variant) => variant.id === requested)
    ?? variants.find((variant) => variant.selectedForSession)
    ?? variants[0]
    ?? null;
  if (!activeVariant) notFound();
  const editor = await getTeacherMicrocourseEditor(activeVariant.id);
  return <div className="space-y-4">
    <MicrocourseVariantSwitcher session={session} variants={variants} activeVariant={activeVariant} topics={topics} />
    {editor.canEdit
      ? <MicrocourseEditor
          session={{ id: session.id, title: session.title, classroomId: session.classroomId, coursewareFrozenAt: session.coursewareFrozenAt }}
          editor={editor}
          canTeach={session.canSelect}
        />
      : <MicrocourseVariantPreview editor={editor} />}
  </div>;
}
