"use client";

import {
  BookOpen,
  CircleAlert,
  FileText,
  Globe2,
  Layers3,
  LoaderCircle,
  Presentation,
  Snowflake,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CoursewareCompactChoiceGroup } from "@/features/courseware-doc/CoursewareCompactChoiceGroup";
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

const scopeIcons = {
  page: FileText,
  lecture: Presentation,
  course: BookOpen,
  family: Layers3,
  all: Globe2,
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
    return <p className="px-4 py-4 text-sm leading-6 text-muted">{t("replacementSelectImage")}</p>;
  }
  if (status === "loading") {
    return <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{t("replacementImpactLoading")}</p>;
  }
  if (status === "error" || !detail) {
    return <p className="flex items-start gap-2 px-4 py-4 text-sm leading-6 text-rose"><CircleAlert className="mt-1 size-4 shrink-0" />{t("replacementImpactFailed", { code: errorCode || "UNKNOWN" })}</p>;
  }

  const scopeChoices = COURSEWARE_REPLACEMENT_IMPACT_SCOPES.map((item) => {
    const Icon = scopeIcons[item];
    return {
      value: item,
      label: t(scopeLabelKeys[item]),
      icon: <Icon className="size-4" strokeWidth={1.7} />,
      meta: counts[item],
    };
  });

  return (
    <div data-courseware-replacement-impact-preview className="flex size-full min-h-0 flex-col gap-3 px-4 py-4">
      <p className="sr-only">{detail.asset.name || asset.name} · {track === "adapted-4x3" ? t("replacementTrack43") : t("replacementTrack169")}</p>

      <CoursewareCompactChoiceGroup
        value={scope}
        choices={scopeChoices}
        ariaLabel={t("replacementScopeLabel")}
        onValueChange={setScope}
      />

      <div className="shrink-0 px-3 py-1 text-xs leading-5 text-muted">
        <p className="font-medium text-ink">{t(scopeLabelKeys[scope])}</p>
        <p>{t("replacementImpactSummary", { count: usages.length, frozen: frozenCount, pinned: pinnedCount })}</p>
        {frozenCount > 0 ? <p className="mt-1 flex items-start gap-1.5 text-amber-700 dark:text-amber-300"><Snowflake className="mt-0.5 size-3.5 shrink-0" />{t("replacementFrozenHint")}</p> : null}
      </div>

      {usages.length > 0 ? (
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <ol className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-1 pr-2">
            {usages.map((usage) => (
              <li key={usage.bindingId} className="min-w-0 overflow-hidden rounded-lg border border-line/70 px-2.5 py-2 text-xs leading-5">
                <p className="truncate font-medium text-ink">{usage.courseTitle}</p>
                <p className="truncate text-muted">{t("replacementUsageLocation", { lecture: usage.lectureNo, lectureName: usage.lectureName, page: usage.pageNo, pageTitle: usage.pageTitle || t("untitledPage") })}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {usage.pinnedRevisionId ? <Badge variant="secondary">{t("replacementPinned")}</Badge> : null}
                  {usage.frozenSessionCount > 0 ? <Badge variant="outline">{t("replacementFrozenCount", { count: usage.frozenSessionCount })}</Badge> : null}
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : <p className="grid min-h-0 flex-1 place-items-center text-xs text-muted">{t("replacementNoUsages")}</p>}
    </div>
  );
}
