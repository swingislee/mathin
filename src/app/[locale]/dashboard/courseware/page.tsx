import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getTemplateProgress } from "@/features/school/dashboard";
import { loadLecturePreview, parseCoursewareTrack } from "@/features/courseware-studio/data";
import { CoursewareTaskQueue, hrefFor } from "@/features/courseware-studio/CoursewareTaskQueue";
import {
  COURSEWARE_STUDIO_PERMS,
  parseCoursewareTaskQuery,
  parseCoursewareTaskTab,
} from "@/features/courseware-studio/data";
import { LecturePreviewDialog } from "@/features/school/curriculum/LecturePreviewDialog";
import { LecturePreviewPanel } from "@/features/school/curriculum/LecturePreviewPanel";
import { SchoolPageHeader } from "@/features/school/PageHeader";
import { StatusStrip, type StatusStripItem } from "@/features/school/stage/StatusStrip";
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

  return <div className="mx-auto w-full max-w-6xl">
    <SchoolPageHeader title={t("workbenchTitle")} />
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <CoursewareTasksContent locale={locale} searchParams={searchParams} />
    </Suspense>
  </div>;
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

  return <>
    {statusItems.length > 0 && <StatusStrip items={statusItems} className="mt-4" />}
    <CoursewareTaskQueue
      locale={locale}
      tab={tab}
      query={taskQuery}
    />
    {preview && (
      <LecturePreviewDialog title={tCourses("lecturePreviewTitle", { no: preview.lecture.no, name: preview.lecture.name })} closeHref={baseHref}>
        <LecturePreviewPanel preview={preview} baseHref={baseHref} workspaceHref={`/dashboard/curriculum/lectures/${preview.lecture.id}?track=${preview.page.aspect === "4:3" ? "adapted-4x3" : "native-16x9"}`} />
      </LecturePreviewDialog>
    )}
  </>;
}
