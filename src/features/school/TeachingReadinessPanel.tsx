import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { CoursewareTrackSettings } from "./CoursewareTrackSettings";
import type { TeachingReadinessRow } from "./classes";
import { StatusStrip } from "./stage/StatusStrip";
import { hasTeachingReadinessRisk } from "./teaching-operations/readiness";

function workflowLabelKey(row: TeachingReadinessRow): string {
  if (!row.workflowStage) return "workflowStageUnknown";
  if (row.workflowStage === "idle") {
    if (!row.currentReleaseNo) return "workflowStage_notStarted";
    return row.hasUnpublishedChanges ? "workflowStage_publishedWithDraft" : "workflowStage_published";
  }
  return `workflowStage_${row.workflowStage}`;
}

/** 教学准备 tab（doc19 §13.5）：画幅默认值之外，追加下一批讲次的备课状态与课件风险。 */
export async function TeachingReadinessPanel({
  classroomId,
  track,
  readiness,
}: {
  classroomId: string;
  track: "native-16x9" | "adapted-4x3";
  readiness: TeachingReadinessRow[];
}) {
  const t = await getTranslations("school.classes");
  const riskCount = readiness.filter(hasTeachingReadinessRisk).length;

  return (
    <div className="grid gap-6">
      <CoursewareTrackSettings classroomId={classroomId} track={track} />

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="font-medium">{t("teachingReadinessTitle")}</h2>
        {readiness.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("teachingReadinessEmpty")}</p>
        ) : (
          <>
            <div className="mt-3">
              <StatusStrip items={[
                { label: t("teachingReadinessTotal"), value: readiness.length },
                { label: t("teachingReadinessRisk"), value: riskCount, tone: riskCount > 0 ? "warning" : "default" },
              ]} />
            </div>
            <ul className="mt-3 divide-y divide-line">
              {readiness.map((row) => (
                <li key={row.sessionId} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span className="w-10 shrink-0 font-mono text-xs text-muted">{row.lectureNo ?? "-"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{row.lectureName}</span>
                  <Badge variant="secondary">{t(`prepStatus_${row.prepStatus ?? "not_started"}`)}</Badge>
                  <Badge variant={hasTeachingReadinessRisk(row) ? "outline" : "secondary"} className={hasTeachingReadinessRisk(row) ? "border-amber-600 text-amber-700 dark:text-amber-300" : undefined}>
                    {t(workflowLabelKey(row))}
                  </Badge>
                  {row.teacherOverrideName && <Badge variant="outline">{t("substituteBy", { name: row.teacherOverrideName })}</Badge>}
                  {row.coursewareTrackOverride && <Badge variant="outline">{row.coursewareTrackOverride === "adapted-4x3" ? t("coursewareTrackAdaptedShort") : t("coursewareTrackNativeShort")}</Badge>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
