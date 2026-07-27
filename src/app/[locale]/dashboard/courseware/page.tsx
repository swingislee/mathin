import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplateProgress } from "@/features/school/dashboard";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { CoursewareTaskCommandPanel, CoursewareTaskQueue, hrefFor } from "@/features/courseware-studio/CoursewareTaskQueue";
import {
  COURSEWARE_STUDIO_PERMS,
  parseCoursewareTaskQuery,
  parseCoursewareTaskTab,
} from "@/features/courseware-studio/data";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import { DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { StatusStrip, type StatusStripItem } from "@/features/school/dashboard-page";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function CoursewareTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("coursewareStudio");

  return (
    <DashboardPage
      title={t("workbenchTitle")}
      commandPanel={
        <Suspense fallback={<DashboardCommandPanel />}>
          <CoursewareTasksCommandPanel locale={locale} searchParams={searchParams} />
        </Suspense>
      }
    >
      <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
        <CoursewareTasksContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function CoursewareTasksCommandPanel({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query] = await Promise.all([searchParams, requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS)]);
  return <CoursewareTaskCommandPanel tab={parseCoursewareTaskTab(query.tab)} query={parseCoursewareTaskQuery(query.q)} />;
}

async function CoursewareTasksContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, tCourses] = await Promise.all([searchParams, getTranslations("school.courses")]);
  const user = await requireAnyPerm(locale, COURSEWARE_STUDIO_PERMS);
  const perms = await getMyPerms(user.id);
  const tab = parseCoursewareTaskTab(query.tab);
  const taskQuery = parseCoursewareTaskQuery(query.q);
  const baseHref = hrefFor(tab, taskQuery);
  const canTemplateProgress = perms.has("course.manage");

  const [templateProgress, preview] = await Promise.all([
    canTemplateProgress ? safe(getTemplateProgress, []) : Promise.resolve([]),
    (async () => {
      const lectureId = first(query.lecture);
      if (!lectureId) return null;
      const track = parseCoursewareTrack(query.track);
      return safe(() => loadLecturePreview(lectureId, track, parsePage(first(query.page))), null);
    })(),
  ]);

  const statusItems: StatusStripItem[] = templateProgress.map((row) => ({
    label: tCourses("grade", { grade: row.grade }),
    value: `${row.ready}/${row.total}`,
  }));

  return <div className="flex min-w-0 flex-col gap-4">
    {statusItems.length > 0 && <StatusStrip items={statusItems} />}
    <CoursewareTaskQueue
      locale={locale}
      tab={tab}
      query={taskQuery}
    />
    {preview && (
      <LecturePreviewDialog title={tCourses("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })} closeHref={baseHref}>
        <LecturePreviewPanel preview={preview} baseHref={baseHref} workspaceHref={`/dashboard/courseware/lectures/${preview.lecture.id}?track=${preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9"}`} />
      </LecturePreviewDialog>
    )}
  </div>;
}
