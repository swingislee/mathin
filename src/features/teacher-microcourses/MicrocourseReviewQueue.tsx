import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    title: string;
    empty: string;
    review: string;
    course: string;
    scope: string;
    progress: string;
    submittedColumn: string;
    action: string;
    grade: (grade: number) => string;
    round: (current: number, required: number) => string;
    submitted: (value: string) => string;
  };
}) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return <section className="border-y border-line/70" aria-labelledby="microcourse-review-queue-title">
    <header className="border-b border-line/70 px-3 py-2.5">
      <h2 id="microcourse-review-queue-title" className="text-sm font-medium">{labels.title}</h2>
      <p className="mt-0.5 text-xs text-muted">{items.length}</p>
    </header>
    <Table>
      <TableHeader><TableRow>
        <TableHead className="h-9">{labels.course}</TableHead>
        <TableHead className="hidden h-9 @2xl/page:table-cell">{labels.scope}</TableHead>
        <TableHead className="h-9">{labels.progress}</TableHead>
        <TableHead className="hidden h-9 @4xl/page:table-cell">{labels.submittedColumn}</TableHead>
        <TableHead className="h-9 text-right">{labels.action}</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {items.map((item) => <TableRow key={item.reviewCycleId}>
          <TableCell className="max-w-96 py-2"><p className="font-medium text-ink">{item.title}</p><p className="mt-0.5 text-xs text-muted">{item.authorName}{item.submissionNote ? ` · ${item.submissionNote}` : ""}</p></TableCell>
          <TableCell className="hidden max-w-72 py-2 @2xl/page:table-cell"><div className="flex flex-wrap gap-1"><Badge variant="outline">{labels.grade(item.grade)}</Badge><Badge variant="outline">{locale === "en" ? item.primaryTopicTitleEn : item.primaryTopicTitleZh}</Badge>{item.classType && <Badge variant="outline">{item.classType}</Badge>}{item.keywords.slice(0, 3).map((keyword) => <Badge key={keyword} variant="outline">{keyword}</Badge>)}</div></TableCell>
          <TableCell className="py-2"><Badge variant="secondary">{labels.round(item.reviewRoundNo, item.requiredReviewRounds)}</Badge><p className="mt-1 text-[11px] text-muted @4xl/page:hidden">{labels.submitted(formatter.format(new Date(item.submittedAt)))}</p></TableCell>
          <TableCell className="hidden py-2 text-xs text-muted @4xl/page:table-cell">{formatter.format(new Date(item.submittedAt))}</TableCell>
          <TableCell className="py-2 text-right"><Link href={`/dashboard/courseware/review/microcourses/${item.reviewCycleId}`} className={cn(buttonVariants({ size: "sm" }))}>{labels.review}</Link></TableCell>
        </TableRow>)}
        {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted">{labels.empty}</TableCell></TableRow>}
      </TableBody>
    </Table>
  </section>;
}
