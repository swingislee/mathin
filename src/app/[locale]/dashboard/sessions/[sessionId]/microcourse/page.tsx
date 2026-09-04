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
import { DashboardPage, DashboardSection } from "@/features/school/dashboard-page";
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
      <Suspense fallback={<div className="h-[42rem] animate-pulse bg-moon/10" />}>
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
    return <DashboardSection className="max-w-2xl" title={t("featureDisabledTitle")} description={t("featureDisabledDescription")}><p className="text-sm text-muted">{t("featureDisabledHint")}</p></DashboardSection>;
  }
  const [variants, topics] = await Promise.all([
    listTeacherMicrocourseVariants(sessionId),
    listTeacherMicrocourseTopics(),
  ]);
  if (variants.length === 0 && !session.canCreate) notFound();
  if (variants.length === 0) return <MicrocourseStartPanel source={{ kind: "session", sessionId }} initialTitle={session.title} topics={topics} />;
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
