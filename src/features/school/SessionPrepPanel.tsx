import { getSessionAssetUrls, getSessionH5BindingUrls, getSessionPageDocs } from "@/features/classroom/courseware/session-assets";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { SessionWorkspaceDetail } from "./classes";
import { getSessionCoursewareTemplate } from "./courses";
import { CoursewareOverlayEditor } from "./CoursewareOverlayEditor";
import { coursewareEditorStateFromFrozenSnapshot } from "./courseware-overlay";
import { LeaveRequestActions } from "./LeaveRequestActions";
import { getSessionCoursewareLearningCheckPages, getSessionLearningSetup } from "./session-learning";
import { SessionPreparationFlow } from "./SessionPreparationFlow";
import { getSessionPreparationArtifacts } from "./session-preparation-artifacts";
import { SessionPrepAutostart } from "./SessionPrepAutostart";
import { SessionPrepSplit } from "./SessionPrepSplit";
import { SessionLessonPlanWorkspace } from "./SessionLessonPlanWorkspace";
import { getTeacherPreparationWorkspace } from "./teacher-preparation";
import { isFeatureEnabled } from "./organization-settings";

export async function SessionPrepPanel({
  detail,
  initialStep,
  initialPageId,
}: {
  detail: SessionWorkspaceDetail;
  initialStep?: "study" | "design" | "rehearsal";
  initialPageId?: string;
}) {
  const [t, lockedPreparationEditingEnabled] = await Promise.all([
    getTranslations("school.session"),
    isFeatureEnabled("teaching.preparation_archive_edit"),
  ]);
  const canViewPrepArchive = Boolean(
    detail.capabilities.canPrepare
      || detail.capabilities.canEnterLive
      || detail.capabilities.canViewReport,
  );
  const prepArchiveUnlocked = Boolean(
    detail.coursewareFrozenAt
      && lockedPreparationEditingEnabled
      && detail.capabilities.canEditPreparationArchive,
  );
  const regularPreparationEditing = Boolean(detail.capabilities.canPrepare && !detail.coursewareFrozenAt);
  const canAmendSessionArchive = Boolean(regularPreparationEditing || prepArchiveUnlocked);
  const preparationWorkflowReadOnly = !canAmendSessionArchive;

  const [template, learningSetup, coursewareLearningCheckPages, sessionDocs, sessionAssets, prepArtifacts, teacherPreparation] = await Promise.all([
    detail.lectureId && !detail.coursewareFrozenAt ? getSessionCoursewareTemplate(detail.id) : Promise.resolve([]),
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
  const solutionPageLabels = Object.fromEntries(sessionDocs.map((pageDoc) => [
    pageDoc.pageDocId,
    t("learningCheckPageOption", {
      no: pageDoc.pageNo,
      title: titleByPageDocId.get(pageDoc.pageDocId) ?? t("learningCheckUntitledPage"),
    }),
  ]));
  const canEditSessionCourseware = canAmendSessionArchive;
  const frozenEditorState = detail.coursewareFrozenAt
    ? coursewareEditorStateFromFrozenSnapshot(detail.courseware, detail.coursewareOverlay)
    : null;
  const editorTemplate = frozenEditorState?.template ?? template;
  const editorOverlay = frozenEditorState?.overlay ?? detail.coursewareOverlay;

  return (
    <>
      {detail.prepStatus === "not_started" && detail.capabilities.canPrepare ? <SessionPrepAutostart sessionId={detail.id} /> : null}
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 px-1">
        {detail.coursewareFrozenAt ? (
          <section className="flex shrink-0 flex-wrap items-start gap-3 rounded-xl border border-line bg-card/70 px-4 py-3">
            {prepArchiveUnlocked
              ? <LockKeyholeOpen size={18} className="mt-0.5 shrink-0 text-leaf" aria-hidden />
              : <LockKeyhole size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-ink">
                {t(prepArchiveUnlocked ? "prepArchiveUnlockedTitle" : "prepArchiveFrozenTitle")}
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                {t(prepArchiveUnlocked ? "prepArchiveUnlockedBody" : "prepArchiveFrozenBody")}
              </p>
            </div>
          </section>
        ) : null}

        <SessionPrepSplit
          flow={(
            <aside className="@container flex min-h-0 min-w-0 flex-1 flex-col">
              {canViewPrepArchive ? (
                <SessionPreparationFlow
                  key={Object.entries(prepArtifacts.reviews)
                    .map(([kind, review]) => `${kind}:${review?.revision ?? 0}:${review?.status ?? "none"}`)
                    .join("|")}
                  sessionId={detail.id}
                  initial={prepArtifacts}
                  solutionRecords={teacherPreparation.solutionRecords}
                  solutionPageLabels={solutionPageLabels}
                  solutionPagePreviews={docPreviews}
                  lessonPlanEditor={(
                    <SessionLessonPlanWorkspace
                      lessonPlan={teacherPreparation.lessonPlan}
                      readOnly={preparationWorkflowReadOnly}
                    />
                  )}
                  initialStage={initialStep}
                  readOnly={preparationWorkflowReadOnly}
                  reviewerReadOnly={!regularPreparationEditing}
                />
              ) : null}
            </aside>
          )}
          courseware={(
            <section className="@container flex min-h-0 min-w-0 flex-1 flex-col">
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
                template={editorTemplate}
                initialOverlay={editorOverlay}
                docPreviews={docPreviews}
                annotations={teacherPreparation.annotations}
                solutionRecords={teacherPreparation.solutionRecords}
                learningCheckPages={coursewareLearningCheckPages}
                initialLearningChecks={learningSetup?.checks ?? []}
                learningChecksLocked={!canAmendSessionArchive}
                learningChecksConfigured={learningSetup?.configured ?? false}
                initialPageId={initialPageId}
                readOnly={!canAmendSessionArchive}
                structureReadOnly={!canEditSessionCourseware}
                customOnly={!detail.lectureId}
              />
            ) : null}
            </section>
          )}
        />
      </div>
    </>
  );
}
