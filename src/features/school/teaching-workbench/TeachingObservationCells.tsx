import { useTranslations } from "next-intl";
import type { TeachingObservations } from "./teaching-learning-summary";
import { LearningCheckStatusMark } from "../LearningCheckStatusMark";
import { LEARNING_CHECK_RATED_STATUSES } from "../session-learning-contract";

export function TeachingPerformance({ value, inline = false }: { value: TeachingObservations; inline?: boolean }) {
  const t = useTranslations("school.teachingWorkbench.observations");
  return <div className={inline ? "flex flex-wrap gap-1" : "grid w-fit grid-cols-3 gap-1"} title={t("basis")} data-teaching-performance>
    {LEARNING_CHECK_RATED_STATUSES.map(status => <LearningCheckStatusMark key={status} status={status} count={value[status]} />)}
  </div>;
}

export function TeachingCoverage({ value, reviewCount }: { value: TeachingObservations; reviewCount: number }) {
  const t = useTranslations("school.teachingWorkbench.observations");
  return <><p>{t("coverage", { done: value.recordedChecks, total: value.totalChecks })}</p>
    <p className="mt-0.5 text-[11px] text-muted">{t("reviews", { count: reviewCount })}</p></>;
}

export function TeachingFocus({ value }: { value: TeachingObservations }) {
  const t = useTranslations("school.teachingWorkbench.observations");
  const focus = value.focusChecks[0];
  return focus ? <div title={t("focusBasis")}><p className="line-clamp-1" title={focus.title}>{focus.title}</p>
    <p className="mt-0.5 text-[11px] text-muted">{t("focusRatio", { count: focus.supported, total: focus.recorded })}</p></div>
    : <span className="text-xs text-muted">{t(value.recordedChecks ? "noSupport" : "noObservations")}</span>;
}
