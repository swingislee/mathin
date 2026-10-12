import { cn } from "@/lib/utils";
import { referenceValidityMessages, type AssessmentReferenceValidity } from "./contract";

export function ReferenceValidity({ value, locale, details = false }: {
  value?: AssessmentReferenceValidity | null; locale: string; details?: boolean;
}) {
  if (!value) return null;
  const m = referenceValidityMessages(locale);
  const hint = value.status === "unknown" ? m.unknownHint : m.historyHint;
  return <div className={cn("space-y-1", details ? "py-2 text-xs" : "mt-1 text-[11px]")} data-reference-validity={value.status}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cn("font-medium", value.status === "valid" ? "text-leaf-deep" : value.status === "expired" ? "text-muted" : "text-crater")} title={hint}>{m[value.status]}</span>
      {details && value.assessedOn && <span className="text-muted">{m.assessedOn} <time dateTime={value.assessedOn}>{value.assessedOn}</time></span>}
      {value.validUntil && <span className="text-muted">{m.validUntil} <time dateTime={value.validUntil}>{value.validUntil}</time></span>}
    </div>
    {details && <p className="text-muted">{hint}</p>}
  </div>;
}
