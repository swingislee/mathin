import { useTranslations } from "next-intl";
import type { TeachingObservations } from "./teaching-learning-summary";

export function TeachingPerformance({ value }: { value: TeachingObservations }) {
  const t = useTranslations("school.teachingWorkbench.observations");
  const supported = value.prompted + value.imitated + value.incomplete;
  const autonomous = value.independent + value.explained;
  return <div title={t("basis")}><p>{t("autonomous", { count: autonomous, total: autonomous + supported })}</p>
    <p className="mt-0.5 text-[11px] text-muted">{t("supportBreakdown", { prompted: value.prompted, imitated: value.imitated, incomplete: value.incomplete })}</p></div>;
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
