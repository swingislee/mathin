import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { DecisionRailContent } from "@/features/school/curriculum/DecisionRailContent";
import { LectureWorkspaceBody } from "@/features/school/curriculum/LectureWorkspaceBody";
import { loadLectureWorkspacePageData } from "@/features/school/curriculum/load-lecture-workspace-page";
import { resolveReturnTarget } from "@/features/school/object-workspace";
import { requireDashboardEnvironment } from "@/lib/auth";

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
  return <div className="flex w-full min-w-0 flex-1 flex-col xl:h-full xl:min-h-0">
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
  const { detail, track, staffOptions, capabilitiesByTrack, preview, canOpenCoursewareWorkbench, canAssign } =
    await loadLectureWorkspacePageData(locale, lectureId, rawSearchParams);

  const baseHref = `/dashboard/courseware/lectures/${detail.lecture.id}`;
  const trackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];

  // doc23 §18：讲次可以从课程版本的教学计划进入，也可以从研发任务队列或适配校对队列进入。
  const backHref = resolveReturnTarget({
    returnTo: rawSearchParams.returnTo,
    fallback: `/dashboard/courses/${detail.family.id}?variant=${detail.variant.id}`,
    environment,
  });

  return <LectureWorkspaceBody
    detail={detail}
    track={track}
    baseHref={baseHref}
    backHref={backHref}
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
