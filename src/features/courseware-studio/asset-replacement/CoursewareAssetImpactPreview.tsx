"use client";

import { CircleAlert, LoaderCircle, Snowflake } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { previewCoursewareImageReplacementImpactAction } from "../actions";
import type {
  CoursewareSharedAssetDetail,
  CoursewareTrack,
  StudioImageAssetUsage,
} from "../data";
import {
  COURSEWARE_REPLACEMENT_IMPACT_SCOPES,
  filterCoursewareReplacementUsages,
  type CoursewareReplacementImpactContext,
  type CoursewareReplacementImpactScope,
} from "./impact-scope";

const scopeLabelKeys = {
  page: "replacementScopePage",
  lecture: "replacementScopeLecture",
  course: "replacementScopeCourse",
  family: "replacementScopeFamily",
  all: "replacementScopeAll",
} as const;

export function CoursewareAssetImpactPreview({
  asset,
  track,
  context,
}: {
  asset: StudioImageAssetUsage | null;
  track: CoursewareTrack;
  context: CoursewareReplacementImpactContext;
}) {
  const t = useTranslations("coursewareWorkspace");
  const [scope, setScope] = useState<CoursewareReplacementImpactScope>("page");
  const [detail, setDetail] = useState<CoursewareSharedAssetDetail | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">(asset ? "loading" : "idle");
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    let active = true;
    if (!asset) return () => { active = false; };
    void previewCoursewareImageReplacementImpactAction({
      sharedAssetId: asset.sharedAssetId,
      track,
    }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setStatus("error");
        setErrorCode(result.code);
        return;
      }
      setDetail(result.data);
      setStatus("loaded");
    }).catch(() => {
      if (!active) return;
      setStatus("error");
      setErrorCode("NETWORK");
    });
    return () => { active = false; };
  }, [asset, track]);

  const counts = useMemo(() => Object.fromEntries(
    COURSEWARE_REPLACEMENT_IMPACT_SCOPES.map((item) => [
      item,
      detail ? filterCoursewareReplacementUsages(detail.usages, context, item).length : 0,
    ]),
  ) as Record<CoursewareReplacementImpactScope, number>, [context, detail]);
  const usages = useMemo(
    () => detail ? filterCoursewareReplacementUsages(detail.usages, context, scope) : [],
    [context, detail, scope],
  );
  const frozenCount = usages.reduce((total, usage) => total + usage.frozenSessionCount, 0);
  const pinnedCount = usages.filter((usage) => usage.pinnedRevisionId !== null).length;

  if (!asset) {
    return <p className="text-sm leading-6 text-muted">{t("replacementSelectImage")}</p>;
  }
  if (status === "loading") {
    return <p className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("replacementImpactLoading")}</p>;
  }
  if (status === "error" || !detail) {
    return <p className="flex items-start gap-2 text-sm leading-6 text-rose"><CircleAlert className="mt-1 size-4 shrink-0" />{t("replacementImpactFailed", { code: errorCode || "UNKNOWN" })}</p>;
  }

  return (
    <div data-courseware-replacement-impact-preview className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{detail.asset.name || asset.name}</p>
          <Badge variant="outline">{track === "adapted-4x3" ? t("replacementTrack43") : t("replacementTrack169")}</Badge>
        </div>
        <p className="text-xs text-muted">{t("replacementReadOnlyHint")}</p>
      </div>

      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={t("replacementScopeLabel")}>
        {COURSEWARE_REPLACEMENT_IMPACT_SCOPES.map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant="secondary"
            aria-pressed={scope === item}
            className={cn("justify-between", item === "all" && "col-span-2", scope === item && "border-crater bg-moon/30")}
            onClick={() => setScope(item)}
          >
            <span>{t(scopeLabelKeys[item])}</span>
            <span className="tabular-nums text-muted">{counts[item]}</span>
          </Button>
        ))}
      </div>

      <div className="rounded-lg border border-line/80 px-3 py-2.5 text-xs leading-5 text-muted">
        <p>{t("replacementImpactSummary", { count: usages.length, frozen: frozenCount, pinned: pinnedCount })}</p>
        {frozenCount > 0 ? <p className="mt-1 flex items-start gap-1.5 text-amber-700 dark:text-amber-300"><Snowflake className="mt-0.5 size-3.5 shrink-0" />{t("replacementFrozenHint")}</p> : null}
      </div>

      {usages.length > 0 ? (
        <ol className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {usages.map((usage) => (
            <li key={usage.bindingId} className="rounded-lg border border-line/70 px-2.5 py-2 text-xs leading-5">
              <p className="truncate font-medium text-ink">{usage.courseTitle}</p>
              <p className="truncate text-muted">{t("replacementUsageLocation", { lecture: usage.lectureNo, lectureName: usage.lectureName, page: usage.pageNo, pageTitle: usage.pageTitle || t("untitledPage") })}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {usage.pinnedRevisionId ? <Badge variant="secondary">{t("replacementPinned")}</Badge> : null}
                {usage.frozenSessionCount > 0 ? <Badge variant="outline">{t("replacementFrozenCount", { count: usage.frozenSessionCount })}</Badge> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="text-xs text-muted">{t("replacementNoUsages")}</p>}
    </div>
  );
}
