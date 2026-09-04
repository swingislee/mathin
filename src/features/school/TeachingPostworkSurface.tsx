import type { ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function TeachingPostworkStatus({
  complete,
  label,
  done,
  total,
  progressLabel,
}: {
  complete: boolean;
  label: string;
  done: number;
  total: number;
  progressLabel: string;
}) {
  return (
    <section
      aria-live="polite"
      className={complete
        ? "flex min-h-10 items-center gap-2 rounded-xl border border-leaf/40 bg-leaf/10 px-3 py-2 text-sm text-leaf-deep"
        : "flex min-h-10 items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-100/60 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/35 dark:text-amber-100"}
      data-shared-teaching-postwork-status
    >
      {complete
        ? <CircleCheck size={16} className="shrink-0" aria-hidden="true" />
        : <CircleAlert size={16} className="shrink-0" aria-hidden="true" />}
      <p className="min-w-0 flex-1 truncate font-medium">{label}</p>
      <Badge variant="outline" className="shrink-0 border-current/30 text-current" title={`${done}/${total}`}>
        {progressLabel}
      </Badge>
    </section>
  );
}

export function TeachingPostworkSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-paper/35 p-4" data-shared-teaching-postwork-section>
      <div>
        <h3 className="font-medium text-ink">{title}</h3>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
