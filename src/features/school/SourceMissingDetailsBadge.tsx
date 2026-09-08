import { Badge } from "@/components/ui/badge";
import { sourceCompletionMessages, type SourceMissingField } from "./source-completion-contract";

export function SourceMissingDetailsBadge({ missing, locale }: { missing: readonly SourceMissingField[]; locale: string }) {
  if (!missing.length) return null;
  const m = sourceCompletionMessages(locale);
  const description = `${m.pending}：${missing.map(field => m.missing[field]).join(locale.startsWith("en") ? ", " : "、")}`;
  return <Badge variant="outline" data-assessment-missing-details title={description} aria-label={description}
    className="max-w-full whitespace-normal rounded-md border-rose/35 bg-cheek/25 px-1.5 text-[11px] text-rose">
    {m.pending}
  </Badge>;
}
