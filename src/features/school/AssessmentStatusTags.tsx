import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AssessmentWorkbenchRow } from "./assessment-workbench-contract";
import { assessmentDetailStatuses, assessmentStatusMessages } from "./assessment-status-contract";
import { sourceCompletionMessages } from "./source-completion-contract";

export function AssessmentStatusTags({ row, locale, showStatus = true }: { row: AssessmentWorkbenchRow; locale: string; showStatus?: boolean }) {
  const labels = assessmentStatusMessages(locale).labels;
  const sourceM = sourceCompletionMessages(locale);
  const missing = row.sourceCompletion?.missing ?? [];
  return <div className="flex flex-wrap items-center gap-1" data-assessment-status-tags>
    {(showStatus ? assessmentDetailStatuses(row) : []).map((status, index) => <Badge key={status} variant="outline" data-assessment-status={status}
      className={cn("max-w-full whitespace-normal rounded-md px-1.5 text-[11px]",
        status === "enrolled" ? "border-leaf-deep/35 bg-leaf/20 text-leaf-deep"
          : ["pending", "cancelled", "no_show", "not_enrolling"].includes(status) ? "border-line bg-line/20 text-muted"
            : "border-crater/40 bg-moon/30 text-ink", index > 0 && "font-normal")}>
      {labels[status]}
    </Badge>)}
    {missing.length ? <Badge variant="outline" data-assessment-missing-details
      title={missing.map(field => sourceM.missing[field]).join(locale.startsWith("en") ? ", " : "、")}
      className="max-w-full whitespace-normal rounded-md border-rose/35 bg-cheek/25 px-1.5 text-[11px] text-rose">
      {sourceM.pending}
    </Badge> : null}
  </div>;
}
