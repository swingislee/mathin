import { getSessionAssetUrls, getSessionH5BindingUrls, getSessionPageDocs } from "@/features/classroom/courseware/session-assets";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { SessionWorkspaceDetail } from "./classes";
import { getLectureCoursewareTemplate } from "./courses";
import { CoursewareOverlayEditor } from "./CoursewareOverlayEditor";
import { LeaveRequestActions } from "./LeaveRequestActions";
import { getSessionCoursewareLearningCheckPages, getSessionLearningSetup } from "./session-learning";
import { SessionPreparationFlow } from "./SessionPreparationFlow";
import { getSessionPreparationArtifacts } from "./session-preparation-artifacts";
import { SessionPrepAutostart } from "./SessionPrepAutostart";
import { SessionLessonPlanWorkspace } from "./SessionLessonPlanWorkspace";
import { getTeacherPreparationWorkspace } from "./teacher-preparation";

export async function SessionPrepPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");
  const canViewPrepArchive = Boolean(
    detail.capabilities.canPrepare
      || detail.capabilities.canEnterLive
      || detail.capabilities.canViewReport,
  );
  const prepReadOnly = Boolean(detail.coursewareFrozenAt) || !detail.capabilities.canPrepare;

  const [template, learningSetup, coursewareLearningCheckPages, sessionDocs, sessionAssets, prepArtifacts, teacherPreparation] = await Promise.all([
    detail.lectureId && !detail.coursewareFrozenAt ? getLectureCoursewareTemplate(detail.lectureId) : Promise.resolve([]),
    canViewPrepArchive ? getSessionLearningSetup(detail.id) : Promise.resolve(null),
    canViewPrepArchive ? getSessionCoursewareLearningCheckPages(detail.id) : Promise.resolve([]),
    canViewPrepArchive ? getSessionPageDocs(detail.id).catch(() => []) : Promise.resolve([]),
    canViewPrepArchive ? getSessionAssetUrls(detail.id).catch(() => []) : Promise.resolve([]),
    getSessionPreparationArtifacts(detail.id),
    getTeacherPreparationWorkspace(detail.id),
  ]);
  const h5BindingUrls = canViewPrepArchive
    ? await getSessionH5BindingUrls(sessionDocs).catch((): Record<string, string> => ({}))
    : {} satisfies Record<string, string>;
  const assetUrlByHash = new Map(sessionAssets.map((asset) => [asset.objectHash, asset.signedUrl]));
  const docPreviews = sessionDocs.map((pageDoc) => ({
    pageDocId: pageDoc.pageDocId,
    doc: pageDoc.doc,
    bindingUrls: Object.fromEntries(pageDoc.bindings.flatMap((binding) => {
      if (binding.kind === "h5") {
        const url = h5BindingUrls[binding.bindingKey];
        return url ? [[binding.bindingKey, url]] : [];
      }
      const url = assetUrlByHash.get(binding.objectHash);
      return url ? [[binding.bindingKey, url]] : [];
    })),
  }));
  const titleByPageDocId = new Map(coursewareLearningCheckPages.map((page) => [page.pageDocId, page.title]));
  const lessonPlanReferencePages = sessionDocs.map((pageDoc) => ({
    pageDocId: pageDoc.pageDocId,
    pageNo: pageDoc.pageNo,
    title: titleByPageDocId.get(pageDoc.pageDocId) ?? t("learningCheckPageOption", { no: pageDoc.pageNo, title: t("learningCheckUntitledPage") }),
  }));
  const canEditOverlay = Boolean(detail.capabilities.canPrepare && !detail.coursewareFrozenAt && detail.lectureId);

  if (!detail.lectureId) {
    return <DashboardEmptyCard>{t("stageEmpty")}</DashboardEmptyCard>;
  }

  return (
    <>
      {detail.prepStatus === "not_started" && detail.capabilities.canPrepare ? <SessionPrepAutostart sessionId={detail.id} /> : null}
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 px-1">
        {detail.coursewareFrozenAt ? (
          <section className="flex shrink-0 flex-wrap items-start gap-3 rounded-xl border border-line bg-card/70 px-4 py-3">
            <LockKeyhole size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-ink">{t("prepArchiveFrozenTitle")}</h2>
              <p className="mt-1 text-xs leading-5 text-muted">{t("prepArchiveFrozenBody")}</p>
            </div>
            <Link
              href={`/dashboard/courseware/lectures/${detail.lectureId}?track=${detail.coursewareTrack}`}
              className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "shrink-0 gap-1.5")}
            >
              {t("openCoursewareWorkspace")}
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </section>
        ) : null}

        <div className="grid min-h-0 min-w-0 flex-1 gap-4 xl:grid-cols-[minmax(24rem,30rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col">
          <div className="border-l border-line pl-4" data-prep-workflow-heading>
            <h2 className="font-display text-lg text-ink">{t("prepFlowTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted">{t("prepFlowActionIntro")}</p>
          </div>

          {canViewPrepArchive ? (
            <SessionPreparationFlow
              key={Object.entries(prepArtifacts.reviews)
                .map(([kind, review]) => `${kind}:${review?.revision ?? 0}:${review?.status ?? "none"}`)
                .join("|")}
              sessionId={detail.id}
              initial={prepArtifacts}
              lessonPlanPresent={teacherPreparation.lessonPlan.id !== null}
              lessonPlanEditor={(
                <SessionLessonPlanWorkspace
                  lessonPlan={teacherPreparation.lessonPlan}
                  pageNotes={teacherPreparation.pageNotes}
                  pages={lessonPlanReferencePages}
                  readOnly={prepReadOnly}
                />
              )}
              readOnly={prepReadOnly}
            />
          ) : null}


        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          {detail.lectureObjectives && (
            <div className="mb-3 flex min-w-0 items-baseline gap-2 border-l-2 border-crater/50 pl-3 text-xs">
              <span className="shrink-0 text-muted">{t("lectureObjectives")}</span>
              <span className="min-w-0 truncate text-ink">{detail.lectureObjectives}</span>
            </div>
          )}

          {detail.pendingLeaveRequests.length > 0 && (
            <section className="mb-3 rounded-xl border border-line bg-card/70 px-3 py-2 text-sm">
              <h3 className="mb-1 text-xs font-medium text-muted">{t("pendingLeaveRequests")}</h3>
              <ul className="flex flex-col gap-1">
                {detail.pendingLeaveRequests.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-ink">{row.studentName}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{row.reason || t("noReason")}</span>
                    {detail.capabilities.canMarkAttendance && <LeaveRequestActions requestId={row.id} />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {canViewPrepArchive ? (
            <CoursewareOverlayEditor
              key={"courseware-editor:" + (detail.coursewareFrozenAt ?? "draft") + ":" + (learningSetup?.configured ? "configured:" : "defaults:") + learningSetup?.checks.map((check) => check.id).join(":") + ":" + coursewareLearningCheckPages.map((page) => page.pageDocId + ":" + page.learningCheckEnabled).join("|")}
              classroomId={detail.classroomId}
              sessionId={detail.id}
              template={detail.coursewareFrozenAt ? [] : template}
              initialOverlay={detail.coursewareFrozenAt
                ? detail.courseware.map((page) => ({ page }))
                : detail.coursewareOverlay}
              docPreviews={docPreviews}
              annotations={teacherPreparation.annotations}
              solutionRecords={teacherPreparation.solutionRecords}
              learningCheckPages={coursewareLearningCheckPages}
              initialLearningChecks={learningSetup?.checks ?? []}
              learningChecksLocked={prepReadOnly || detail.state !== "scheduled"}
              learningChecksConfigured={learningSetup?.configured ?? false}
              readOnly={!canEditOverlay}
            />
          ) : null}
        </section>
        </div>
      </div>
    </>
  );
}
