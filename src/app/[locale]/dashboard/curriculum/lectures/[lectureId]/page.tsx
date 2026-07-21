import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DecisionRail } from "@/features/school/stage/DecisionRail";
import { DecisionRailContent } from "@/features/school/curriculum/DecisionRailContent";
import { LectureWorkspaceBody } from "@/features/school/curriculum/LectureWorkspaceBody";
import { LectureWorkspaceShell } from "@/features/school/curriculum/LectureWorkspaceShell";
import { loadLectureWorkspacePageData } from "@/features/school/curriculum/load-lecture-workspace-page";

export default async function LectureWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col xl:h-full xl:min-h-0">
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
  const [{ lectureId }, rawSearchParams, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("school.lecture"),
  ]);
  const { detail, track, staffOptions, capabilitiesByTrack, preview, canOpenCoursewareWorkbench, canAssign } =
    await loadLectureWorkspacePageData(locale, lectureId, rawSearchParams);

  const variantHref = `/dashboard/courses/${detail.family.id}?variant=${detail.variant.id}`;
  const baseHref = `/dashboard/curriculum/lectures/${detail.lecture.id}`;
  const trackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];

  return <LectureWorkspaceShell
    body={<LectureWorkspaceBody
      detail={detail}
      track={track}
      baseHref={baseHref}
      variantHref={variantHref}
      canOpenCoursewareWorkbench={canOpenCoursewareWorkbench}
      canAssign={canAssign}
      staffOptions={staffOptions}
      preview={preview}
    />}
    decisionRail={<DecisionRail title={t("decisionRailTitle")}>
      <DecisionRailContent
        lectureId={detail.lecture.id}
        trackState={trackState}
        capabilities={capabilitiesByTrack[track]}
        emergencyPublishEnabled={detail.policy.emergencyPublishEnabled}
        history={detail.history}
      />
    </DecisionRail>}
  />;
}
