import { getSessionAssetUrls, getSessionH5BindingUrls, getSessionPageDocs } from "@/features/classroom/courseware/session-assets";
import { getTranslations } from "next-intl/server";
import { DashboardEmptyCard } from "@/features/school/dashboard-page";
import type { SessionWorkspaceDetail } from "./classes";
import { getLectureCoursewareTemplate } from "./courses";
import { CoursewareOverlayEditor } from "./CoursewareOverlayEditor";
import { LeaveRequestActions } from "./LeaveRequestActions";
import { getSessionCoursewareLearningCheckPages, getSessionLearningSetup } from "./session-learning";
import { SessionPreparationFlow } from "./SessionPreparationFlow";
import { getSessionPreparationArtifacts } from "./session-preparation-artifacts";
import { SessionPrepAutostart } from "./SessionPrepAutostart";

export async function SessionPrepPanel({ detail }: { detail: SessionWorkspaceDetail }) {
  const t = await getTranslations("school.session");

  const [template, learningSetup, coursewareLearningCheckPages, sessionDocs, sessionAssets, prepArtifacts] = await Promise.all([
    detail.lectureId ? getLectureCoursewareTemplate(detail.lectureId) : Promise.resolve([]),
    detail.capabilities.canPrepare ? getSessionLearningSetup(detail.id) : Promise.resolve(null),
    detail.capabilities.canPrepare ? getSessionCoursewareLearningCheckPages(detail.id) : Promise.resolve([]),
    detail.capabilities.canPrepare ? getSessionPageDocs(detail.id).catch(() => []) : Promise.resolve([]),
    detail.capabilities.canPrepare ? getSessionAssetUrls(detail.id).catch(() => []) : Promise.resolve([]),
    getSessionPreparationArtifacts(detail.id),
  ]);
  const h5BindingUrls = detail.capabilities.canPrepare
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
  const canEditOverlay = Boolean(detail.capabilities.canPrepare && !detail.coursewareFrozenAt && detail.lectureId);

  if (!detail.lectureId) {
    return <DashboardEmptyCard>{t("stageEmpty")}</DashboardEmptyCard>;
  }

  return (
    <>
      {detail.prepStatus === "not_started" && detail.capabilities.canPrepare ? <SessionPrepAutostart sessionId={detail.id} /> : null}
      <div className="grid h-full min-h-0 min-w-0 gap-4 px-1 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="min-h-0 min-w-0 overflow-y-auto">
          <div className="border-l border-line pl-4" data-prep-workflow-heading>
            <h2 className="font-display text-lg text-ink">{t("prepFlowTitle")}</h2>
            <p className="mt-1 text-xs leading-5 text-muted">{t("prepFlowActionIntro")}</p>
          </div>

          {detail.capabilities.canPrepare ? (
            <SessionPreparationFlow
              key={Object.entries(prepArtifacts.reviews)
                .map(([kind, review]) => `${kind}:${review?.revision ?? 0}:${review?.status ?? "none"}`)
                .join("|")}
              sessionId={detail.id}
              initial={prepArtifacts}
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

          {canEditOverlay ? (
            <CoursewareOverlayEditor
              key={"courseware-editor:" + (learningSetup?.configured ? "configured:" : "defaults:") + learningSetup?.checks.map((check) => check.id).join(":") + ":" + coursewareLearningCheckPages.map((page) => page.pageDocId + ":" + page.learningCheckEnabled).join("|")}
              classroomId={detail.classroomId}
              sessionId={detail.id}
              template={template}
              initialOverlay={detail.coursewareOverlay}
              docPreviews={docPreviews}
              learningCheckPages={coursewareLearningCheckPages}
              initialLearningChecks={learningSetup?.checks ?? []}
              learningChecksLocked={detail.state !== "scheduled"}
              learningChecksConfigured={learningSetup?.configured ?? false}
            />
          ) : detail.coursewareFrozenAt ? (
            <p className="text-sm text-muted">{t("overlayFrozen")}</p>
          ) : null}
        </section>
      </div>
    </>
  );
}
