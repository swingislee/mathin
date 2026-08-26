import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseReviewQueueItem } from "./data";

export function MicrocourseReviewQueue({
  items,
  locale,
  labels,
}: {
  items: TeacherMicrocourseReviewQueueItem[];
  locale: string;
  labels: {
    empty: string;
    review: string;
    grade: (grade: number) => string;
    round: (current: number, required: number) => string;
    submitted: (value: string) => string;
  };
}) {
  if (items.length === 0) return <div className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-muted">{labels.empty}</div>;
  return <div className="grid gap-4 lg:grid-cols-2">{items.map((item) => <Card key={item.reviewCycleId}>
    <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle className="truncate text-base">{item.title}</CardTitle><p className="mt-1 text-sm text-muted">{item.authorName} · {labels.submitted(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.submittedAt)))}</p></div><Badge variant="secondary">{labels.round(item.reviewRoundNo, item.requiredReviewRounds)}</Badge></div></CardHeader>
    <CardContent><div className="flex flex-wrap gap-2"><Badge variant="outline">{labels.grade(item.grade)}</Badge><Badge variant="outline">{locale === "en" ? item.primaryTopicTitleEn : item.primaryTopicTitleZh}</Badge>{item.classType && <Badge variant="outline">{item.classType}</Badge>}{item.keywords.map((keyword) => <Badge key={keyword} variant="outline">{keyword}</Badge>)}</div>{item.submissionNote && <p className="mt-3 line-clamp-2 text-sm text-muted">{item.submissionNote}</p>}<div className="mt-4 flex justify-end"><Link href={`/dashboard/courseware/review/microcourses/${item.reviewCycleId}`} className={cn(buttonVariants({ size: "sm" }))}>{labels.review}</Link></div></CardContent>
  </Card>)}</div>;
}

