import { CalendarClock, Layers3, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  return <Card data-testid="microcourse-session-workspace-queue">
    <CardHeader>
      <CardTitle className="text-base">{labels.title}</CardTitle>
      <CardDescription>{labels.description}</CardDescription>
    </CardHeader>
    <CardContent>
      {items.length === 0 ? <p className="py-8 text-center text-sm text-muted">{labels.empty}</p> : <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => <div key={item.sessionId} className="rounded-xl border border-line bg-paper/35 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-medium">{item.sessionTitle}</h3>
              <p className="mt-1 truncate text-sm text-muted">{item.classroomName}</p>
            </div>
            {item.coursewareFrozenAt && <Badge>{labels.frozen}</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><Layers3 className="size-3.5" />{item.variantCount > 0 ? labels.variants(item.variantCount) : labels.noVariant}</span>
            <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" />{labels.teacher(item.primaryTeacherName)}</span>
            {item.scheduledAt && <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" />{dateFormatter.format(new Date(item.scheduledAt))}</span>}
          </div>
          <p className="mt-3 text-xs text-muted">{item.selectedVariantName ? labels.selected(item.selectedVariantName) : labels.notSelected}</p>
          <div className="mt-4 flex justify-end">
            <Link href={`/dashboard/sessions/${item.sessionId}/microcourse`} className={cn(buttonVariants({ size: "sm" }))}>{labels.open}</Link>
          </div>
        </div>)}
      </div>}
    </CardContent>
  </Card>;
}
