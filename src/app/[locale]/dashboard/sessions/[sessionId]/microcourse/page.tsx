import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MicrocourseEditor } from "@/features/teacher-microcourses/MicrocourseEditor";
import { MicrocourseStartPanel } from "@/features/teacher-microcourses/MicrocourseStartPanel";
import {
  getTeacherMicrocourseEditor,
  getTeacherMicrocourseForSession,
  listTeacherMicrocourseTopics,
} from "@/features/teacher-microcourses/data";
import { getSessionWorkspaceDetail } from "@/features/school/classes";
import { DashboardPage } from "@/features/school/dashboard-page";
import { isFeatureEnabled } from "@/features/school/organization-settings";
import { requirePerm } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TeacherMicrocoursePage({
  params,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
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
      <Suspense fallback={<div className="h-[42rem] animate-pulse rounded-2xl border border-line bg-card" />}>
        <TeacherMicrocourseContent locale={locale} sessionId={sessionId} />
      </Suspense>
    </DashboardPage>
  );
}

async function TeacherMicrocourseContent({ locale, sessionId }: { locale: string; sessionId: string }) {
  if (!UUID_PATTERN.test(sessionId)) notFound();
  await requirePerm(locale, "courseware.microcourse.author");
  const [t, enabled, session] = await Promise.all([
    getTranslations("teacherMicrocourses"),
    isFeatureEnabled("teaching.teacher_microcourses_v1"),
    getSessionWorkspaceDetail(sessionId),
  ]);
  if (!session || session.lectureId !== null) notFound();
  if (!enabled) {
    return <Card className="max-w-2xl"><CardHeader><CardTitle>{t("featureDisabledTitle")}</CardTitle><CardDescription>{t("featureDisabledDescription")}</CardDescription></CardHeader><CardContent><p className="text-sm text-muted">{t("featureDisabledHint")}</p></CardContent></Card>;
  }
  const [summary, topics] = await Promise.all([
    getTeacherMicrocourseForSession(sessionId),
    listTeacherMicrocourseTopics(),
  ]);
  if (!summary && !session.capabilities.canPrepare) notFound();
  if (!summary) return <MicrocourseStartPanel sessionId={sessionId} sessionTitle={session.name} topics={topics} />;
  const editor = await getTeacherMicrocourseEditor(summary.id);
  return <MicrocourseEditor session={{ id: session.id, title: session.name, classroomId: session.classroomId, coursewareFrozenAt: session.coursewareFrozenAt }} editor={editor} />;
}
