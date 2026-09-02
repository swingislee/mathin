import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardSection, DashboardTableShell } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { FormalCoursewareReviewQueueItem } from "./formal-review-data";

export function FormalCoursewareReviewQueue({
  items,
  locale,
  labels,
}: {
  items: FormalCoursewareReviewQueueItem[];
  locale: string;
  labels: {
    title: string;
    empty: string;
    course: string;
    lecture: string;
    progress: string;
    submitted: string;
    open: string;
    nativeTrack: string;
    adaptedTrack: string;
    inReview: string;
    readyToPublish: string;
    round: (current: number, required: number) => string;
  };
}) {
  const formatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const returnTo = "/dashboard/courseware/review?tab=formal";

  return <DashboardSection title={labels.title} description={String(items.length)}>
    <DashboardTableShell><Table>
      <TableHeader><TableRow>
        <TableHead className="h-9">{labels.course}</TableHead>
        <TableHead className="h-9">{labels.lecture}</TableHead>
        <TableHead className="h-9">{labels.progress}</TableHead>
        <TableHead className="hidden h-9 @3xl/page:table-cell">{labels.submitted}</TableHead>
        <TableHead className="h-9 text-right" />
      </TableRow></TableHeader>
      <TableBody>
        {items.map((item) => {
          const search = new URLSearchParams({ track: item.track, returnTo });
          return <TableRow key={item.reviewCycleId}>
            <TableCell className="max-w-80 py-2"><p className="truncate font-medium text-ink">{item.familyTitle}</p><p className="mt-0.5 truncate text-xs text-muted">{item.courseTitle}</p></TableCell>
            <TableCell className="max-w-80 py-2"><p className="truncate text-ink">{item.lectureNo}. {item.lectureName}</p><p className="mt-0.5 truncate text-xs text-muted">{item.creatorName}{item.submissionNote ? ` · ${item.submissionNote}` : ""}</p></TableCell>
            <TableCell className="py-2"><div className="flex flex-wrap gap-1"><Badge variant="outline">{item.track === "adapted-4x3" ? labels.adaptedTrack : labels.nativeTrack}</Badge><Badge variant={item.stage === "ready_to_publish" ? "secondary" : "outline"}>{item.stage === "ready_to_publish" ? labels.readyToPublish : labels.inReview}</Badge></div><p className="mt-1 text-[11px] text-muted">{labels.round(item.reviewRoundNo, item.requiredReviewRounds)}</p></TableCell>
            <TableCell className="hidden py-2 text-xs text-muted @3xl/page:table-cell">{formatter.format(new Date(item.submittedAt))}</TableCell>
            <TableCell className="py-2 text-right"><Link href={`/dashboard/courseware/lectures/${item.lectureId}?${search.toString()}`} className={cn(buttonVariants({ size: "sm" }))}>{labels.open}</Link></TableCell>
          </TableRow>;
        })}
        {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-12 text-center text-sm text-muted">{labels.empty}</TableCell></TableRow>}
      </TableBody>
    </Table></DashboardTableShell>
  </DashboardSection>;
}
