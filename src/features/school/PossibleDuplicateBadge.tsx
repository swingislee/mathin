import { Badge } from "@/components/ui/badge";
import { schoolRecordReviewMessages, type SchoolRecordSubject } from "./school-record-review-contract";
import { Student360Trigger } from "./Student360Sheet";

export function PossibleDuplicateBadge({ count = 0, subject, name, locale }: {
  count?: number; subject: SchoolRecordSubject; name: string; locale: string;
}) {
  if (count === 0) return null;
  const m = schoolRecordReviewMessages(locale);
  return <Student360Trigger subject={subject} fallback={{ name, grade: null }} className="block max-w-full">
    <Badge variant="outline" title={m.duplicateHint} className="mt-0.5 px-1 text-[10px]">{m.possibleDuplicate} · {count}</Badge>
  </Student360Trigger>;
}
