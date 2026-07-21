import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { CoursewarePageEditor } from "@/features/courseware-studio/CoursewarePageEditor";
import {
  loadCoursewareStudioPage,
  loadCoursewareWorkbenchContext,
  parseCoursewareTrack,
} from "@/features/courseware-studio/data";
import { getLectureWorkspaceDetail } from "@/features/school/curriculum/lecture-workspace-detail";
import { resolveLectureReviewCapabilities } from "@/features/school/teaching-operations/capabilities";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function StudioCoursewarePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; lectureId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale, lectureId }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const t = await getTranslations("coursewareStudio");
  const user = await requirePerm(locale, "courseware.page.edit");

  const [context, perms] = await Promise.all([
    loadCoursewareWorkbenchContext(lectureId),
    getMyPerms(user.id),
  ]);
  if (!context) notFound();

  const track = parseCoursewareTrack(query.track);
  const requestedPageId = first(query.page);
  const lectureWorkspaceHref = `/dashboard/curriculum/lectures/${lectureId}?track=${track}`;
  const canPublish = perms.has("courseware.release.publish");

  if (!context.firstPageDocId) {
    return <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <Link href={lectureWorkspaceHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("backToLectureWorkspace")}</Link>
        <span className="truncate text-sm text-ink">{t("lectureTitle", { no: context.lecture.no, name: context.lecture.name })}</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-sm text-muted">{t("workbenchNoPages")}</p>
      </div>
    </div>;
  }

  let editor = await loadCoursewareStudioPage(lectureId, requestedPageId ?? context.firstPageDocId, track);
  if (!editor && requestedPageId !== context.firstPageDocId) {
    editor = await loadCoursewareStudioPage(lectureId, context.firstPageDocId, track);
  }
  if (!editor) notFound();

  const detail = await getLectureWorkspaceDetail(lectureId).catch((error) => {
    if (error instanceof Error && (error.message.includes("LECTURE_NOT_FOUND") || error.message.includes("FORBIDDEN_SCOPE"))) return null;
    throw error;
  });
  const trackState = detail?.tracks.find((row) => row.track === track) ?? null;
  const canSubmitReview = detail && trackState
    ? resolveLectureReviewCapabilities({
      canEditPage: true,
      canReview: perms.has("courseware.review"),
      canPublish,
      canEmergencyPublish: perms.has("courseware.emergency_publish"),
      stage: trackState.stage,
      activeCycleCreatorId: trackState.activeReviewCycle?.creatorId ?? null,
      allowCreatorAsReviewer: detail.policy.allowCreatorAsReviewer,
      currentUserId: user.id,
    }).canSubmit
    : false;

  return <CoursewarePageEditor
    lecture={editor.lecture}
    track={editor.track}
    page={editor.page}
    pages={editor.pages}
    initialDoc={editor.activeRevision.doc}
    baseRevisionNo={editor.activeRevision.revisionNo}
    revisions={editor.revisions}
    releases={editor.releaseHistory}
    bindingUrls={editor.bindingUrls}
    imageAssetUsage={editor.imageAssetUsage}
    copyTargets={editor.copyTargets}
    canPublish={canPublish}
    canSubmitReview={canSubmitReview}
    lectureWorkspaceHref={lectureWorkspaceHref}
  />;
}
