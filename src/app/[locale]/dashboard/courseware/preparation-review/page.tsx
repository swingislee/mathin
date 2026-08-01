import { Suspense } from "react";
import { FileText, Link2, PencilLine } from "lucide-react";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import { DashboardCard, DashboardEmptyCard, DashboardPageHeader } from "@/features/school/dashboard-page";
import { PreparationReviewActions } from "@/features/school/PreparationReviewActions";
import {
  getSessionPreparationReviewDetail,
  listSessionPreparationReviews,
  type SessionPreparationReviewQueueItem,
  type SignedPrepArtifactFile,
} from "@/features/school/session-preparation-reviews";
import { getSessionPreparationReviewCourseware } from "@/features/school/session-preparation-review-courseware";
import { SessionPreparationCoursewareReview } from "@/features/school/SessionPreparationCoursewareReview";
import { SessionLessonPlanReview } from "@/features/school/SessionLessonPlanWorkspace";
import { SolutionRecordPreview } from "@/features/school/CoursewareAnnotationBoard";
import { SolutionRecordExportButton } from "@/features/school/SessionSolutionArchive";
import { annotationContentSchema } from "@/features/school/teacher-preparation-contract";
import type { PrepArtifactKind } from "@/features/school/session-preparation-artifacts";
import { Link } from "@/i18n/navigation";
import { requireDashboardEnvironment } from "@/lib/auth";
import { cn } from "@/lib/utils";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PreparationReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sessionId?: string | string[]; focus?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="w-full min-w-0">
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
        <PreparationReviewContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PreparationReviewContent({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Promise<{ sessionId?: string | string[]; focus?: string | string[] }>;
}) {
  await requireDashboardEnvironment(locale, ["staff"]);
  const t = await getTranslations("school.session");
  const raw = await searchParams;
  const requestedSessionId = typeof raw.sessionId === "string" && UUID_PATTERN.test(raw.sessionId)
    ? raw.sessionId
    : undefined;
  const rows = await listSessionPreparationReviews(requestedSessionId);
  const selectedSessionId = requestedSessionId ?? rows[0]?.sessionId;
  const [detail, courseware] = selectedSessionId
    ? await Promise.all([
        getSessionPreparationReviewDetail(selectedSessionId),
        getSessionPreparationReviewCourseware(selectedSessionId),
      ])
    : [null, null];
  const focus = typeof raw.focus === "string" ? raw.focus.slice(0, 160) : undefined;
  const selectedRows = rows.filter((row) => row.sessionId === selectedSessionId);
  const focusedKind = selectedRows.find((row) => focus === `${row.sessionId}:${row.artifactKind}`)?.artifactKind
    ?? selectedRows[0]?.artifactKind
    ?? "solution";
  const coursewarePrepStep = prepStepForArtifact(focusedKind);

  return (
    <>
      <NotificationFocus target={focus} />
      <DashboardPageHeader title={t("prepReviewQueueTitle")} description={t("prepReviewQueueIntro")} />
      {rows.length === 0 || !detail ? (
        <DashboardEmptyCard>{t("prepReviewQueueEmpty")}</DashboardEmptyCard>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-2xl border border-line bg-card">
            <div className="border-b border-line px-4 py-3 text-xs font-medium text-muted">{t("prepReviewQueueTitle")}</div>
            <ol className="max-h-[38rem] divide-y divide-line overflow-y-auto">
              {rows.map((row) => (
                <li key={row.sessionId + row.artifactKind}>
                  <Link
                    href={"/dashboard/courseware/preparation-review?sessionId=" + row.sessionId + "&focus=" + row.sessionId + ":" + row.artifactKind}
                    className={cn("block px-4 py-3 transition hover:bg-moon/20", row.sessionId === selectedSessionId && "bg-crater/10")}
                  >
                    <p className="truncate text-sm font-medium text-ink">{row.classroomName} · {row.sessionTitle}</p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                      <span>{t("prepArtifactKind_" + row.artifactKind)}</span>
                      <ReviewBadge row={row} />
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>

          <section className="min-w-0">
            <div className="mb-3">
              <h2 className="font-display text-lg text-ink">{selectedRows[0]?.classroomName} · {selectedRows[0]?.sessionTitle}</h2>
              <p className="mt-1 text-xs text-muted">{t("prepReviewSessionIntro")}</p>
            </div>
            <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
              <div className="grid min-w-0 gap-4">
                {selectedRows.map((row) => (
                  <div
                    key={row.artifactKind}
                    data-notification-target={row.sessionId + ":" + row.artifactKind}
                    tabIndex={-1}
                    className="min-w-0 outline-none"
                  >
                    <DashboardCard
                      title={t("prepArtifactKind_" + row.artifactKind)}
                      description={[
                        t("prepReviewRevision", { revision: row.revision }),
                        row.assignedReviewerName ? t("prepReviewerAssigned", { name: row.assignedReviewerName }) : null,
                        row.selfReview ? t("prepReviewerSelfReview") : null,
                      ].filter(Boolean).join(" · ")}
                      actions={(
                        <div className="flex items-center gap-2">
                          <Link
                            href={artifactEditHref(row.sessionId, row.artifactKind)}
                            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-7 gap-1.5 px-2 text-xs")}
                          >
                            <PencilLine size={13} aria-hidden />
                            {t("prepReviewEditArtifact")}
                          </Link>
                          <ReviewBadge row={row} />
                        </div>
                      )}
                      className="transition"
                    >
                      <ArtifactContent kind={row.artifactKind} detail={detail} courseware={courseware} />
                      {row.reviewNote ? <p className="mt-3 rounded-lg bg-line/30 p-2 text-xs text-muted">{row.reviewNote}</p> : null}
                      {row.status === "pending" ? <PreparationReviewActions sessionId={row.sessionId} artifactKind={row.artifactKind} /> : null}
                    </DashboardCard>
                  </div>
                ))}
              </div>
              {courseware ? (
                <div className="min-w-0 xl:sticky xl:top-3">
                  <SessionPreparationCoursewareReview
                    sessionId={selectedSessionId!}
                    pages={courseware.pages}
                    docs={courseware.docs}
                    overlayAssetUrls={courseware.overlayAssetUrls}
                    prepStep={coursewarePrepStep}
                  />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function prepStepForArtifact(kind: PrepArtifactKind): "study" | "design" | "rehearsal" {
  if (kind === "lesson_plan") return "design";
  if (kind === "rehearsal_video") return "rehearsal";
  return "study";
}

function artifactEditHref(sessionId: string, kind: PrepArtifactKind): string {
  const step = prepStepForArtifact(kind);
  return `/dashboard/sessions/${sessionId}?stage=pre&prepStep=${step}&focus=prep-${kind}`;
}

async function ReviewBadge({ row }: { row: SessionPreparationReviewQueueItem }) {
  const t = await getTranslations("school.session");
  const label = row.status === "approved" ? "prepReviewApproved"
    : row.status === "changes_requested" ? "prepReviewChangesRequested" : "prepReviewPending";
  return (
    <Badge
      variant={row.status === "changes_requested" ? "danger" : "secondary"}
      className={row.status === "approved" ? "border-leaf/50 bg-leaf/25 text-leaf-deep" : undefined}
    >
      {t(label)}
    </Badge>
  );
}

async function ArtifactContent({
  kind,
  detail,
  courseware,
}: {
  kind: PrepArtifactKind;
  detail: Awaited<ReturnType<typeof getSessionPreparationReviewDetail>>;
  courseware: Awaited<ReturnType<typeof getSessionPreparationReviewCourseware>> | null;
}) {
  const t = await getTranslations("school.session");
  if (kind === "rehearsal_video") {
    return detail.rehearsalVideoUrl ? (
      <a href={detail.rehearsalVideoUrl} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "mt-4 w-full")}>
        <Link2 size={14} />{detail.rehearsalVideoUrl}
      </a>
    ) : null;
  }
  if (kind === "lesson_plan") {
    return (
      <div className="mt-4 space-y-4">
        {detail.lessonPlan ? (
          <div className="max-h-[34rem] overflow-y-auto rounded-xl border border-line bg-paper p-2">
            <SessionLessonPlanReview content={detail.lessonPlan.content} revision={detail.lessonPlan.revision} />
          </div>
        ) : null}
        <FileLinks files={detail.signedLessonPlanFiles} />
      </div>
    );
  }
  const boardRecords = detail.solutionRecords.flatMap((record) => {
    if (record.source !== "board") return [];
    const parsed = annotationContentSchema.safeParse(record.content.items ?? record.content.strokes);
    return parsed.success ? [{ ...record, items: parsed.data }] : [];
  });
  return (
    <div className="mt-4 space-y-3">
      {detail.solutionNotes ? <p className="whitespace-pre-wrap text-sm text-muted">{detail.solutionNotes}</p> : null}
      <FileLinks files={detail.signedSolutionFiles} />
      {boardRecords.map((record) => {
        const pagePreview = record.pageDocId
          ? courseware?.docs.find((item) => item.pageDocId === record.pageDocId) ?? null
          : null;
        const previewId = `review-solution-record-preview-${record.id}`;
        return (
          <div key={record.id}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">{t("annotationReviewRecord", { page: record.pageDocId?.slice(0, 8) ?? "—", revision: record.revision })}</p>
              <SolutionRecordExportButton
                previewId={previewId}
                fileName={`solution-${record.pageDocId ?? record.id}-r${record.revision}`}
                solutionRecordId={record.id}
                disabled={!pagePreview}
              />
            </div>
            <SolutionRecordPreview
              items={record.items}
              label={t("annotationReviewPreview", { revision: record.revision })}
              previewId={previewId}
              pagePreview={pagePreview}
              unavailableLabel={t("solutionArchivePageUnavailable")}
            />
          </div>
        );
      })}
    </div>
  );
}

function FileLinks({ files }: { files: SignedPrepArtifactFile[] }) {
  return (
    <ul className="space-y-2">
      {files.map((file) => (
        <li key={file.path}>
          {file.url ? (
            <a href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-ink underline-offset-2 hover:underline">
              <FileText size={14} className="shrink-0 text-muted" /><span className="min-w-0 truncate">{file.name}</span>
            </a>
          ) : <span className="text-xs text-muted">{file.name}</span>}
        </li>
      ))}
    </ul>
  );
}
