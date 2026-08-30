import { CalendarClock, Layers3, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardSection, DashboardTableShell } from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseSessionWorkspace } from "./data";

export function MicrocourseSessionWorkspaceQueue({
  items,
  locale,
  labels,
}: {
  items: TeacherMicrocourseSessionWorkspace[];
  locale: string;
  labels: {
    title: string;
    description: string;
    empty: string;
    open: string;
    session: string;
    variant: string;
    teacherColumn: string;
    schedule: string;
    status: string;
    action: string;
    variants: (count: number) => string;
    noVariant: string;
    selected: (name: string) => string;
    notSelected: string;
    frozen: string;
    teacher: (name: string) => string;
  };
}) {
  const dateFormatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return <DashboardSection title={labels.title} description={labels.description} data-testid="microcourse-session-workspace-queue" aria-labelledby="microcourse-session-workspace-title">
    <DashboardTableShell><Table>
      <TableHeader><TableRow>
        <TableHead className="h-9">{labels.session}</TableHead>
        <TableHead className="h-9">{labels.variant}</TableHead>
        <TableHead className="hidden h-9 @2xl/page:table-cell">{labels.teacherColumn}</TableHead>
        <TableHead className="hidden h-9 @4xl/page:table-cell">{labels.schedule}</TableHead>
        <TableHead className="hidden h-9 @3xl/page:table-cell">{labels.status}</TableHead>
        <TableHead className="h-9 text-right">{labels.action}</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {items.map((item) => <TableRow key={item.sessionId}>
          <TableCell className="max-w-80 py-2"><p className="truncate font-medium text-ink">{item.sessionTitle}</p><p className="mt-0.5 truncate text-xs text-muted">{item.classroomName}</p></TableCell>
          <TableCell className="py-2"><span className="inline-flex items-center gap-1 text-xs"><Layers3 className="size-3.5 text-muted" />{item.variantCount > 0 ? labels.variants(item.variantCount) : labels.noVariant}</span><p className="mt-0.5 max-w-64 truncate text-[11px] text-muted">{item.selectedVariantName ? labels.selected(item.selectedVariantName) : labels.notSelected}</p></TableCell>
          <TableCell className="hidden py-2 text-xs text-muted @2xl/page:table-cell"><span className="inline-flex items-center gap-1"><UserRound className="size-3.5" />{labels.teacher(item.primaryTeacherName)}</span></TableCell>
          <TableCell className="hidden py-2 text-xs text-muted @4xl/page:table-cell">{item.scheduledAt ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{dateFormatter.format(new Date(item.scheduledAt))}</span> : "—"}</TableCell>
          <TableCell className="hidden py-2 @3xl/page:table-cell">{item.coursewareFrozenAt ? <Badge>{labels.frozen}</Badge> : <span className="text-xs text-muted">—</span>}</TableCell>
          <TableCell className="py-2 text-right"><Link href={`/dashboard/sessions/${item.sessionId}/microcourse`} className={cn(buttonVariants({ size: "sm" }))}>{labels.open}</Link></TableCell>
        </TableRow>)}
        {items.length === 0 && <TableRow><TableCell colSpan={6} className="py-12 text-center text-sm text-muted">{labels.empty}</TableCell></TableRow>}
      </TableBody>
    </Table></DashboardTableShell>
  </DashboardSection>;
}
