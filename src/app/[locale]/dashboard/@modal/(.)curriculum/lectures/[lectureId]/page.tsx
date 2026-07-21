import { getTranslations, setRequestLocale } from "next-intl/server";
import { DecisionRail } from "@/features/school/stage/DecisionRail";
import { DecisionRailContent } from "@/features/school/curriculum/DecisionRailContent";
import { LectureOverlay } from "@/features/school/curriculum/LectureOverlay";
import { LectureWorkspaceBody } from "@/features/school/curriculum/LectureWorkspaceBody";
import { loadLectureWorkspacePageData } from "@/features/school/curriculum/load-lecture-workspace-page";

export default async function LectureOverlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, lectureId }, rawSearchParams, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("school.lecture"),
  ]);
  setRequestLocale(locale);
  const { detail, track, staffOptions, capabilitiesByTrack, preview, canOpenCoursewareWorkbench, canAssign } =
    await loadLectureWorkspacePageData(locale, lectureId, rawSearchParams);

  const variantHref = `/dashboard/courses/${detail.family.id}?variant=${detail.variant.id}`;
  const baseHref = `/dashboard/curriculum/lectures/${detail.lecture.id}`;
  const trackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];

  return <LectureOverlay
    title={t("lectureTitle", { no: detail.lecture.no, name: detail.lecture.name })}
    decisionRail={<DecisionRail title={t("decisionRailTitle")}>
      <DecisionRailContent
        lectureId={detail.lecture.id}
        trackState={trackState}
        capabilities={capabilitiesByTrack[track]}
        emergencyPublishEnabled={detail.policy.emergencyPublishEnabled}
        history={detail.history}
      />
    </DecisionRail>}
  >
    <LectureWorkspaceBody
      detail={detail}
      track={track}
      baseHref={baseHref}
      variantHref={variantHref}
      canOpenCoursewareWorkbench={canOpenCoursewareWorkbench}
      canAssign={canAssign}
      staffOptions={staffOptions}
      preview={preview}
    />
  </LectureOverlay>;
}
