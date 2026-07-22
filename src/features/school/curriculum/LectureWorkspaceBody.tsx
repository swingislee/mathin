import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import type { CoursewareLecturePreview, CoursewareTrack } from "@/features/courseware-studio/data";
import { ContextBar } from "@/features/school/stage/ContextBar";
import { ObjectBar } from "@/features/school/stage/ObjectBar";
import { ObjectWorkspace } from "@/features/school/stage/ObjectWorkspace";
import { StatusStrip } from "@/features/school/stage/StatusStrip";
import type { StaffOption } from "@/features/school/classes";
import { ResponsibilityPanel } from "@/features/school/teaching-operations/ResponsibilityPanel";
import { Link } from "@/i18n/navigation";
import { LectureCoursewarePreview } from "./LectureCoursewarePreview";
import type { LectureWorkspaceDetail } from "./types";
import { lectureStageLabelKey } from "./stage-label";

function trackHref(baseHref: string, track: CoursewareTrack) {
  const search = new URLSearchParams({ track });
  return `${baseHref}?${search.toString()}`;
}

function pageHref(baseHref: string, track: CoursewareTrack, page: number) {
  const search = new URLSearchParams({ track });
  if (page > 1) search.set("page", String(page));
  return `${baseHref}?${search.toString()}`;
}

export async function LectureWorkspaceBody({
  detail,
  track,
  baseHref,
  variantHref,
  canOpenCoursewareWorkbench,
  canAssign,
  staffOptions,
  preview,
}: {
  detail: LectureWorkspaceDetail;
  track: CoursewareTrack;
  baseHref: string;
  variantHref: string;
  canOpenCoursewareWorkbench: boolean;
  canAssign: boolean;
  staffOptions: StaffOption[];
  preview: CoursewareLecturePreview | null;
}) {
  const t = await getTranslations("school.lecture");
  const currentTrackState = detail.tracks.find((row) => row.track === track) ?? detail.tracks[0];
  const canEditThisTrack = currentTrackState && ["idle", "editing", "changes_requested"].includes(currentTrackState.stage);

  const primaryAction = canOpenCoursewareWorkbench && canEditThisTrack
    ? <Link href={`/studio/courseware/${detail.lecture.id}?track=${track}`} className={buttonVariants({ size: "sm" })}>{t("openWorkbench")}</Link>
    : undefined;

  const statusItems = detail.tracks.map((row) => {
    const { key, params } = lectureStageLabelKey(row);
    return {
      label: row.track === "adapted-4x3" ? t("trackAdapted") : t("trackNative"),
      value: t(key, params),
      tone: (row.stage === "changes_requested" || (row.internalDueAt && new Date(row.internalDueAt) < new Date())) ? "critical" as const : "default" as const,
    };
  });

  const effectiveOwner = detail.effectiveAssignments.find((row) => row.responsibility === "owner");

  return <ObjectWorkspace
    scroll="internal"
    objectBar={<ObjectBar
      title={t("lectureTitle", { no: detail.lecture.no, name: detail.lecture.name })}
      backHref={variantHref}
      backLabel={t("backToVariant")}
      context={`${detail.variant.title}`}
      status={detail.tracks.find((row) => row.hasUnpublishedChanges) ? <AlertTriangle size={16} className="text-amber-600" aria-label={t("hasUnpublishedChanges")} /> : undefined}
      primaryAction={primaryAction}
    />}
    contextBar={<ContextBar
      tabs={[
        { value: "native-16x9", label: t("trackNative"), href: trackHref(baseHref, "native-16x9") },
        { value: "adapted-4x3", label: t("trackAdapted"), href: trackHref(baseHref, "adapted-4x3") },
      ]}
      activeTab={track}
    />}
    statusStrip={<StatusStrip items={statusItems} />}
  >
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-sm font-medium text-ink">{t("objectives")}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{detail.lecture.objectives || t("noObjectives")}</p>
      </section>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-sm font-medium text-ink">{t("authoritativePreview")}</h2>
        {preview ? (
          <div className="mt-3">
            <LectureCoursewarePreview
              preview={preview}
              prevHref={preview.pageIndex > 1 ? pageHref(baseHref, track, preview.pageIndex - 1) : null}
              nextHref={preview.pageIndex < preview.pages.length ? pageHref(baseHref, track, preview.pageIndex + 1) : null}
            />
          </div>
        ) : <p className="mt-2 text-sm text-muted">{t("previewUnavailable")}</p>}
      </section>

      {effectiveOwner && <p className="text-sm text-muted">
        {t("effectiveOwner", { name: effectiveOwner.userName })}
        {effectiveOwner.sourceLabel && <span className="ml-1 text-xs">({t("effectiveOwnerSource", { source: effectiveOwner.sourceLabel })})</span>}
      </p>}

      <ResponsibilityPanel
        scopeType="lecture"
        scopeId={detail.lecture.id}
        assignments={detail.assignments}
        staffOptions={staffOptions}
        canManage={canAssign}
        title={t("lectureResponsibility")}
      />

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="text-sm font-medium text-ink">{t("usage")}</h2>
        {detail.usage.length === 0 ? <p className="mt-2 text-sm text-muted">{t("usageEmpty")}</p> : (
          <ul className="mt-2 divide-y divide-line">
            {detail.usage.map((row) => <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <Link href={`/dashboard/classes/${row.classroomId}`} className="min-w-0 truncate text-ink hover:text-crater">{row.classroomName}</Link>
              <span className="shrink-0 text-xs text-muted">{row.scheduledAt ? new Date(row.scheduledAt).toLocaleString() : "—"}</span>
            </li>)}
          </ul>
        )}
      </section>
    </div>
  </ObjectWorkspace>;
}
