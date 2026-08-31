import { Suspense } from "react";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { DecisionRailContent } from "@/features/school/curriculum/DecisionRailContent";
import { LectureWorkspaceBody } from "@/features/school/curriculum/LectureWorkspaceBody";
import { loadLectureWorkspacePageData } from "@/features/school/curriculum/load-lecture-workspace-page";
import { parseReturnTo } from "@/features/school/object-workspace";
import { parseCoursewareTrack } from "@/features/courseware-studio/data";
import { loadUnifiedCoursewareWorkspaceData } from "@/features/courseware-studio/unified-workspace-data";
import { parseUnifiedWorkspaceCanvas, UnifiedCoursewareWorkspace } from "@/features/courseware-studio/UnifiedCoursewareWorkspace";
import { requireDashboardEnvironment } from "@/lib/auth";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// doc22 §5.19：原 /dashboard/curriculum/lectures/[lectureId] 的 curriculum 是代码领域名
// 泄漏——系统里根本没有 /dashboard/curriculum 首页，那是一个没有父页面的虚假中间层。
export default async function LectureWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="flex w-full min-w-0 flex-1 flex-col panel-canvas">
    <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
      <LectureWorkspaceContent locale={locale} params={params} searchParams={searchParams} />
    </Suspense>
  </div>;
}

async function LectureWorkspaceContent({
  locale,
  params,
  searchParams,
}: {
  locale: string;
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ lectureId }, rawSearchParams, { environment }] = await Promise.all([
    params,
    searchParams,
    requireDashboardEnvironment(locale, ["staff"]),
  ]);

  const returnTo = parseReturnTo({ returnTo: rawSearchParams.returnTo, environment });
  if (first(rawSearchParams.workspace) === "courseware") {
    const workspace = await loadUnifiedCoursewareWorkspaceData(locale, lectureId, rawSearchParams);
    return <UnifiedCoursewareWorkspace
      detail={workspace.detail}
      nativePreview={workspace.nativePreview}
      adaptedPreview={workspace.adaptedPreview}
      canvas={parseUnifiedWorkspaceCanvas(rawSearchParams.canvas)}
      entryTrack={parseCoursewareTrack(rawSearchParams.track)}
      returnTo={returnTo}
    />;
  }

  const { detail, track, staffOptions, capabilitiesByTrack, preview, microcourseReviewCycleId, canOpenCoursewareWorkbench, canAssign } =
    await loadLectureWorkspacePageData(locale, lectureId, rawSearchParams);

  if (microcourseReviewCycleId) {
    redirect(`/${locale}/dashboard/courseware/review/microcourses/${microcourseReviewCycleId}`);
  }

  const baseHref = `/dashboard/courseware/lectures/${detail.lecture.id}`;
  const trackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];

  // doc23 §18：讲次可以从课程版本的教学计划进入，也可以从研发任务队列或适配校对队列进入。
  const backHref = returnTo ?? `/dashboard/courses/${detail.family.id}?variant=${detail.variant.id}`;

  return <LectureWorkspaceBody
    detail={detail}
    track={track}
    baseHref={baseHref}
    backHref={backHref}
    returnTo={returnTo}
    canOpenCoursewareWorkbench={canOpenCoursewareWorkbench}
    canAssign={canAssign}
    staffOptions={staffOptions}
    preview={preview}
    decisionContent={
      <DecisionRailContent
        lectureId={detail.lecture.id}
        trackState={trackState}
        capabilities={capabilitiesByTrack[track]}
        emergencyPublishEnabled={detail.policy.emergencyPublishEnabled}
        history={detail.history}
      />
    }
  />;
}
