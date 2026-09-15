import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LearningCheckStatusIcon } from "./LearningCheckStatusIcon";
import { LEARNING_CHECK_STATUSES, type LearningCheckStatus } from "./session-learning-contract";
import { LEARNING_CHECK_STATUS_STYLE } from "./session-learning-visual";

/** 只读学情沿用登记面板的图标与状态色；完整含义保留给悬停和读屏。 */
export function LearningCheckStatusMark({ status, count, detail, solid = false }: {
  status: LearningCheckStatus; count?: number; detail?: string; solid?: boolean;
}) {
  const t = useTranslations("school.session");
  const label = `${t(`learningStatus_${status}`)}${count === undefined ? "" : ` · ${count}`}${detail ? ` · ${detail}` : ""}`;
  const style = LEARNING_CHECK_STATUS_STYLE[status];
  return <Badge variant="outline" role="img" title={label} aria-label={label} data-learning-status={status}
    className={cn("h-6 shrink-0 justify-center gap-1 rounded-md p-0 text-[11px] tabular-nums", count === undefined ? "w-6" : "min-w-9 px-1", solid ? style.active : [style.card, style.icon])}>
    <LearningCheckStatusIcon status={status} size={14} />
    {count !== undefined && <span aria-hidden>{count}</span>}
  </Badge>;
}

export function LearningCheckStatusLegend() {
  const t = useTranslations("school.session");
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted" data-learning-legend>
    {LEARNING_CHECK_STATUSES.map(status => <span key={status} className="inline-flex items-center gap-1">
      <LearningCheckStatusMark status={status} solid />{t(`learningStatusShort_${status}`)}
    </span>)}
  </div>;
}
