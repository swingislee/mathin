import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardPage,
} from "@/features/school/dashboard-page";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { HomeProps } from "./shared";
import { staffHomeHref } from "./staff-home-contract";
import { StaffHomeViewTabs } from "./StaffHomeViewTabs";
import {
  getStaffOverviewData,
  type StaffOverviewBusinessFact,
  type StaffOverviewCapacityRow,
  type StaffOverviewPersonMetric,
  type StaffOverviewSourceKey,
  type StaffOverviewSupportFunnelRow,
  type StaffOverviewTeacherRow,
  type StaffOverviewTeacherParticipationRow,
  type StaffOverviewTeacherParticipationSummary,
} from "./staff-overview-data";
import {
  STAFF_OVERVIEW_METRICS,
  type StaffOverviewGrain,
  type StaffOverviewMetric,
  type StaffOverviewTrendPoint,
} from "./staff-overview-contract";

type MetricLabels = Record<StaffOverviewMetric, string>;

interface CapacityVisualDatum {
  key: string;
  label: string;
  classCount: number | null;
  fullSeats: number | null;
  enrolledSeats: number | null;
  minimumOpenGap: number | null;
  healthyDelta: number | null;
  remainingSeats: number | null;
}

function valueOrDash(value: number | null): string {
  return value === null ? "—" : String(value);
}

function signedOrDash(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

function factDifference(fact: Pick<StaffOverviewBusinessFact, "current" | "previous">): number | null {
  if (fact.current === null || fact.previous === null) return null;
  return fact.current - fact.previous;
}

function periodHref(grain: StaffOverviewGrain): string {
  return staffHomeHref("overview", grain);
}

function rangeLabel(locale: string, timeZone: string, start: string, cutoff: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone });
  return `${formatter.format(new Date(start))}–${formatter.format(new Date(cutoff))}`;
}

function MiniTrend({ points }: { points: StaffOverviewTrendPoint[] | null }) {
  if (!points || points.length === 0) return <span className="block h-6" />;
  const width = 120;
  const height = 24;
  const values = points.flatMap((point) => [point.current, point.previous]).filter((value): value is number => value !== null);
  const maximum = Math.max(1, ...values);
  const xAt = (index: number) => points.length === 1 ? width / 2 : index * width / (points.length - 1);
  const yAt = (value: number) => height - 2 - value / maximum * (height - 4);
  const line = (key: "current" | "previous") => points
    .map((point, index) => point[key] === null ? null : `${xAt(index)},${yAt(point[key]!)}`)
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1 h-6 w-full" aria-hidden>
      <polyline points={line("previous")} className="fill-none stroke-muted/65" strokeWidth="1.3" strokeDasharray="3 3" />
      <polyline points={line("current")} className="fill-none stroke-rose" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const FACT_TONES = [
  "border-t-moon bg-moon/10",
  "border-t-leaf-deep bg-leaf/10",
  "border-t-cheek bg-cheek/10",
  "border-t-crater bg-crater/5",
  "border-t-moon bg-moon/10",
  "border-t-leaf-deep bg-leaf/10",
] as const;

function BusinessFactBand({
  facts,
  title,
  labels,
  currentLabel,
  previousLabel,
  differenceLabel,
}: {
  facts: StaffOverviewBusinessFact[];
  title: string;
  labels: MetricLabels;
  currentLabel: string;
  previousLabel: string;
  differenceLabel: string;
}) {
  return (
    <section aria-labelledby="staff-overview-business-facts">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3">
        <h2 id="staff-overview-business-facts" className="text-xs font-medium text-ink">{title}</h2>
        <p className="flex shrink-0 items-center gap-2 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-rose" />{currentLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted" />{previousLabel}</span>
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 @2xl/page:grid-cols-3 @4xl/page:grid-cols-6">
        {facts.map((fact, index) => (
          <div
            key={fact.key}
            className={cn("min-w-0 rounded-xl border border-line/75 border-t-2 px-3 pb-1.5 pt-2", FACT_TONES[index % FACT_TONES.length])}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="truncate text-[11px] text-muted">{labels[fact.key]}</p>
              <span className="shrink-0 text-[9px] tabular-nums text-muted">
                {differenceLabel} {signedOrDash(factDifference(fact))}
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2">
              <strong className="font-display text-2xl font-normal leading-none tabular-nums text-ink">{valueOrDash(fact.current)}</strong>
              <span className="truncate text-[9px] tabular-nums text-muted">{previousLabel} {valueOrDash(fact.previous)}</span>
            </div>
            <MiniTrend points={fact.trend} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PendingStrip({
  facts,
  title,
  countLabel,
  shortLabel,
  fullLabel,
}: {
  facts: Array<{ key: string; value: number | null; href: string }>;
  title: string;
  countLabel: string;
  shortLabel: (key: string) => string;
  fullLabel: (key: string) => string;
}) {
  return (
    <section
      aria-labelledby="staff-overview-pending"
      className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-line/75 bg-line/70 @3xl/page:grid-cols-[auto_repeat(7,minmax(0,1fr))]"
    >
      <div className="col-span-2 flex min-h-10 items-center justify-between gap-2 bg-card px-3 @3xl/page:col-span-1">
        <h2 id="staff-overview-pending" className="whitespace-nowrap text-xs font-medium text-ink">{title}</h2>
        <span className="text-[9px] text-muted @3xl/page:hidden">{countLabel}</span>
      </div>
      {facts.map((fact) => (
        <Link
          key={fact.key}
          href={fact.href}
          title={fullLabel(fact.key)}
          className="flex min-h-10 min-w-0 items-center gap-1.5 bg-card px-2.5 text-muted transition-colors hover:bg-moon/15 hover:text-ink"
        >
          <span className="min-w-0 flex-1 truncate text-[10px]">{shortLabel(fact.key)}</span>
          <strong className="shrink-0 font-display text-base font-normal tabular-nums text-ink">{valueOrDash(fact.value)}</strong>
          <ArrowUpRight className="size-3 shrink-0" aria-hidden />
        </Link>
      ))}
    </section>
  );
}

function CockpitPanel({
  title,
  meta,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line/80 bg-card/90", className)}>
      <header className="flex min-h-11 shrink-0 min-w-0 items-center justify-between gap-3 border-b border-line/70 px-3">
        <h2 className="min-w-0 truncate text-sm font-medium text-ink">{title}</h2>
        {meta ? <div className="shrink-0 text-[10px] text-muted">{meta}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

function PersonComparisonCell({
  value,
  maximum,
  label,
  previousLabel,
}: {
  value: StaffOverviewPersonMetric;
  maximum: number;
  label?: string;
  previousLabel: string;
}) {
  const currentWidth = value.current === null ? 0 : value.current / maximum * 100;
  const previousWidth = value.previous === null ? 0 : value.previous / maximum * 100;
  const difference = value.current === null || value.previous === null ? null : value.current - value.previous;
  return (
    <div className="min-w-0 px-2 py-2" title={`${label ?? ""} ${valueOrDash(value.current)} / ${valueOrDash(value.previous)}`}>
      {label ? <p className="mb-1 truncate text-[10px] text-muted">{label}</p> : null}
      <div className="flex min-w-0 items-baseline justify-between gap-1">
        <strong className="font-display text-lg font-normal leading-none tabular-nums text-ink">{valueOrDash(value.current)}</strong>
        <span className="truncate text-[9px] tabular-nums text-muted">{signedOrDash(difference)}</span>
      </div>
      <p className="mt-0.5 text-[8px] tabular-nums text-muted">{previousLabel} {valueOrDash(value.previous)}</p>
      <div className="mt-1 space-y-0.5" aria-hidden>
        <div className="h-1 overflow-hidden rounded-full bg-line/45"><div className="h-full rounded-full bg-rose/80" style={{ width: `${currentWidth}%` }} /></div>
        <div className="h-1 overflow-hidden rounded-full bg-line/45"><div className="h-full rounded-full bg-muted/55" style={{ width: `${previousWidth}%` }} /></div>
      </div>
    </div>
  );
}

function SupportFunnelPanel({
  rows,
  title,
  metricLabels,
  currentLabel,
  previousLabel,
  differenceLabel,
  peopleLabel,
  personLabel,
  unassignedLabel,
  attributionNote,
  emptyLabel,
}: {
  rows: StaffOverviewSupportFunnelRow[];
  title: string;
  metricLabels: MetricLabels;
  currentLabel: string;
  previousLabel: string;
  differenceLabel: string;
  peopleLabel: string;
  personLabel: string;
  unassignedLabel: string;
  attributionNote: string;
  emptyLabel: string;
}) {
  const maxima = Object.fromEntries(STAFF_OVERVIEW_METRICS.map((metric) => [
    metric,
    Math.max(1, ...rows.flatMap((row) => [row.metrics[metric].current ?? 0, row.metrics[metric].previous ?? 0])),
  ])) as Record<StaffOverviewMetric, number>;
  const gridClass = "grid-cols-[minmax(7rem,1.2fr)_repeat(6,minmax(4.4rem,1fr))]";

  return (
    <CockpitPanel
      title={title}
      meta={(
        <span className="inline-flex items-center gap-2">
          <span>{peopleLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-rose" />{currentLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted" />{previousLabel}</span>
        </span>
      )}
      className="h-[36rem] @4xl/page:h-full @4xl/page:min-h-0"
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="hidden min-h-0 flex-1 overflow-auto @2xl/page:block">
        <div className="min-w-[38rem]">
          <div className={cn("sticky top-0 z-10 grid border-b border-line/70 bg-card/95", gridClass)}>
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[10px] text-muted">
              <span>{personLabel}</span>
              <span>{differenceLabel}</span>
            </div>
            {STAFF_OVERVIEW_METRICS.map((metric) => (
              <div key={metric} className="flex items-center justify-center border-l border-line/60 px-1 py-2 text-center text-[10px] leading-tight text-muted">
                {metricLabels[metric]}
              </div>
            ))}
          </div>
          {rows.map((row) => (
            <div key={row.key} className={cn("grid border-b border-line/55 last:border-b-0", gridClass)}>
              <div className="min-w-0 px-3 py-2.5">
                <p className="truncate text-xs font-medium text-ink" title={row.name || unassignedLabel}>{row.name || unassignedLabel}</p>
                <p className="mt-1 truncate text-[9px] text-muted">{personLabel}</p>
              </div>
              {STAFF_OVERVIEW_METRICS.map((metric) => (
                <div key={metric} className="border-l border-line/55">
                  <PersonComparisonCell value={row.metrics[metric]} maximum={maxima[metric]} previousLabel={previousLabel} />
                </div>
              ))}
            </div>
          ))}
          {rows.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted">{emptyLabel}</p> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 @2xl/page:hidden">
        {rows.map((row) => (
          <section key={row.key} className="overflow-hidden rounded-lg border border-line/70">
            <header className="flex items-center justify-between gap-2 border-b border-line/60 bg-paper/30 px-3 py-2">
              <h3 className="truncate text-xs font-medium text-ink">{row.name || unassignedLabel}</h3>
              <span className="text-[9px] text-muted">{personLabel}</span>
            </header>
            <div className="grid grid-cols-2 divide-x divide-y divide-line/50">
              {STAFF_OVERVIEW_METRICS.map((metric) => (
                <PersonComparisonCell
                  key={metric}
                  value={row.metrics[metric]}
                  maximum={maxima[metric]}
                  label={metricLabels[metric]}
                  previousLabel={previousLabel}
                />
              ))}
            </div>
          </section>
        ))}
        {rows.length === 0 ? <p className="px-4 py-12 text-center text-sm text-muted">{emptyLabel}</p> : null}
      </div>

      <p className="shrink-0 border-t border-line/70 px-3 py-1.5 text-[9px] leading-4 text-muted">{attributionNote}</p>
    </CockpitPanel>
  );
}

function percentage(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${Math.round(numerator / denominator * 100)}%`;
}

function TeacherOutcomeBar({
  label,
  value,
  maximum,
  previousLabel,
  tone,
}: {
  label: string;
  value: StaffOverviewPersonMetric;
  maximum: number;
  previousLabel: string;
  tone: "rose" | "leaf";
}) {
  const currentWidth = value.current === null ? 0 : value.current / maximum * 100;
  const previousWidth = value.previous === null ? 0 : value.previous / maximum * 100;
  const difference = value.current === null || value.previous === null ? null : value.current - value.previous;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[9px] text-muted">{label}</span>
        <span className="shrink-0 text-[9px] tabular-nums text-muted">{previousLabel} {valueOrDash(value.previous)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <strong className="w-7 shrink-0 text-right font-display text-lg font-normal leading-none tabular-nums text-ink">{valueOrDash(value.current)}</strong>
        <div className="min-w-0 flex-1 space-y-0.5" aria-hidden>
          <div className="h-1.5 overflow-hidden rounded-full bg-line/45">
            <div
              className={cn("h-full rounded-full", tone === "rose" ? "bg-rose/80" : "bg-leaf-deep/80")}
              style={{ width: `${currentWidth}%` }}
            />
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line/45">
            <div className="h-full rounded-full bg-muted/55" style={{ width: `${previousWidth}%` }} />
          </div>
        </div>
        <span className="w-8 shrink-0 text-right text-[9px] tabular-nums text-muted">{signedOrDash(difference)}</span>
      </div>
    </div>
  );
}

function TeacherOutcomePanel({
  title,
  rows,
  summary,
  currentLabel,
  previousLabel,
  peopleLabel,
  participantLabel,
  enrollmentLabel,
  conversionLabel,
  unattributedLabel,
  note,
  emptyLabel,
}: {
  title: string;
  rows: StaffOverviewTeacherParticipationRow[];
  summary: StaffOverviewTeacherParticipationSummary;
  currentLabel: string;
  previousLabel: string;
  peopleLabel: string;
  participantLabel: string;
  enrollmentLabel: string;
  conversionLabel: string;
  unattributedLabel: string;
  note: string;
  emptyLabel: string;
}) {
  const participantMaximum = Math.max(1, ...rows.flatMap((row) => [row.participants.current ?? 0, row.participants.previous ?? 0]));
  const enrollmentMaximum = Math.max(1, ...rows.flatMap((row) => [row.enrollments.current ?? 0, row.enrollments.previous ?? 0]));

  return (
    <CockpitPanel
      title={title}
      meta={(
        <span className="inline-flex items-center gap-2">
          <span>{peopleLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-rose" />{currentLabel}</span>
          <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted" />{previousLabel}</span>
        </span>
      )}
      className="h-[26rem] @4xl/page:h-full @4xl/page:min-h-0"
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="grid shrink-0 grid-cols-4 border-b border-line/70">
        {[
          { label: participantLabel, value: valueOrDash(summary.participants.current), previous: summary.participants.previous },
          { label: enrollmentLabel, value: valueOrDash(summary.enrollments.current), previous: summary.enrollments.previous },
          { label: conversionLabel, value: percentage(summary.enrollments.current, summary.participants.current), previous: null },
          { label: unattributedLabel, value: valueOrDash(summary.unattributedParticipants.current), previous: summary.unattributedParticipants.previous },
        ].map((item, index) => (
          <dl key={item.label} className={cn("min-w-0 px-2.5 py-2", index > 0 && "border-l border-line/55")}>
            <dt className="truncate text-[9px] text-muted">{item.label}</dt>
            <dd className="mt-0.5 font-display text-lg leading-none tabular-nums text-ink">{item.value}</dd>
            <dd className="mt-1 truncate text-[8px] tabular-nums text-muted">
              {item.previous === null ? currentLabel : `${previousLabel} ${valueOrDash(item.previous)}`}
            </dd>
          </dl>
        ))}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-line/55 overflow-y-auto">
        {rows.map((row) => (
          <div key={row.userId} className="grid min-w-0 gap-2 px-3 py-2 @xl/page:grid-cols-[minmax(5.5rem,.7fr)_minmax(7rem,1fr)_minmax(7rem,1fr)] @xl/page:items-center">
            <div className="flex min-w-0 items-baseline justify-between gap-2 @xl/page:block">
              <p className="truncate text-xs font-medium text-ink" title={row.name}>{row.name}</p>
              <span className="shrink-0 text-[9px] tabular-nums text-muted">
                {conversionLabel} {percentage(row.enrollments.current, row.participants.current)}
              </span>
            </div>
            <TeacherOutcomeBar
              label={participantLabel}
              value={row.participants}
              maximum={participantMaximum}
              previousLabel={previousLabel}
              tone="rose"
            />
            <TeacherOutcomeBar
              label={enrollmentLabel}
              value={row.enrollments}
              maximum={enrollmentMaximum}
              previousLabel={previousLabel}
              tone="leaf"
            />
          </div>
        ))}
        {rows.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">{emptyLabel}</p> : null}
      </div>
      <p className="shrink-0 border-t border-line/70 px-3 py-1.5 text-[9px] leading-4 text-muted">{note}</p>
    </CockpitPanel>
  );
}

function CapacityVisualRow({
  row,
  labels,
}: {
  row: CapacityVisualDatum;
  labels: { classes: string; minimum: string; healthy: string; remaining: string };
}) {
  const enrolledPercent = row.enrolledSeats !== null && row.fullSeats && row.fullSeats > 0
    ? Math.min(100, Math.max(0, row.enrolledSeats / row.fullSeats * 100))
    : 0;
  const healthySeats = row.enrolledSeats !== null && row.healthyDelta !== null
    ? row.enrolledSeats - row.healthyDelta
    : null;
  const healthyPercent = healthySeats !== null && row.fullSeats && row.fullSeats > 0
    ? Math.min(100, Math.max(0, healthySeats / row.fullSeats * 100))
    : null;

  return (
    <div className="px-3 py-2.5">
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <strong className="min-w-0 truncate font-medium text-ink" title={row.label}>{row.label}</strong>
        <span className="shrink-0 tabular-nums text-muted">{valueOrDash(row.classCount)} {labels.classes}</span>
        <span className="shrink-0 font-medium tabular-nums text-ink">{valueOrDash(row.enrolledSeats)}/{valueOrDash(row.fullSeats)}</span>
      </div>
      <div className="relative mt-2 h-2 overflow-visible rounded-full bg-line/55" aria-hidden>
        <div className="h-full rounded-full bg-leaf-deep/75" style={{ width: `${enrolledPercent}%` }} />
        {healthyPercent !== null ? (
          <span className="absolute top-[-3px] h-3.5 w-px bg-rose" style={{ left: `${healthyPercent}%` }} />
        ) : null}
      </div>
      <p className="mt-1.5 truncate text-[9px] tabular-nums text-muted">
        {labels.minimum} {valueOrDash(row.minimumOpenGap)} · {labels.healthy} {signedOrDash(row.healthyDelta)} · {labels.remaining} {valueOrDash(row.remainingSeats)}
      </p>
    </div>
  );
}

function CapacityGroup({
  title,
  rows,
  emptyLabel,
  labels,
  className,
}: {
  title: string;
  rows: CapacityVisualDatum[];
  emptyLabel: string;
  labels: { classes: string; minimum: string; healthy: string; remaining: string };
  className?: string;
}) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-line/60 bg-paper/25 px-3">
        <h3 className="text-xs font-medium text-ink">{title}</h3>
        <span className="text-[9px] tabular-nums text-muted">{rows.length}</span>
      </header>
      <div className="min-h-0 flex-1 divide-y divide-line/55 overflow-y-auto">
        {rows.map((row) => <CapacityVisualRow key={row.key} row={row} labels={labels} />)}
        {rows.length === 0 ? <p className="px-4 py-10 text-center text-xs text-muted">{emptyLabel}</p> : null}
      </div>
    </section>
  );
}

function CapacityPanel({
  title,
  snapshotItems,
  teachers,
  grades,
  teacherTitle,
  gradeTitle,
  teacherEmpty,
  gradeEmpty,
  labels,
  legendEnrolled,
  legendHealthy,
  policy,
}: {
  title: string;
  snapshotItems: Array<{ label: string; value: string; note: string }>;
  teachers: CapacityVisualDatum[];
  grades: CapacityVisualDatum[];
  teacherTitle: string;
  gradeTitle: string;
  teacherEmpty: string;
  gradeEmpty: string;
  labels: { classes: string; minimum: string; healthy: string; remaining: string };
  legendEnrolled: string;
  legendHealthy: string;
  policy: string;
}) {
  return (
    <CockpitPanel
      title={title}
      meta={(
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-leaf-deep/75" />{legendEnrolled}</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-rose" />{legendHealthy}</span>
        </span>
      )}
      className="h-[42rem] @4xl/page:h-full @4xl/page:min-h-0"
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="grid shrink-0 grid-cols-2 border-b border-line/70 @xl/page:grid-cols-5">
        {snapshotItems.map((item, index) => (
          <dl
            key={item.label}
            className={cn(
              "flex min-w-0 items-center justify-between gap-2 px-2.5 py-2",
              index > 0 && "border-l border-line/55",
              index === snapshotItems.length - 1 && "col-span-2 @xl/page:col-span-1",
            )}
            title={item.note}
          >
            <dt className="truncate text-[9px] text-muted">{item.label}</dt>
            <dd className="shrink-0 font-display text-base leading-none tabular-nums text-ink">{item.value}</dd>
          </dl>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-2 @6xl/page:grid-cols-2 @6xl/page:grid-rows-1">
        <CapacityGroup title={teacherTitle} rows={teachers} emptyLabel={teacherEmpty} labels={labels} />
        <CapacityGroup
          title={gradeTitle}
          rows={grades}
          emptyLabel={gradeEmpty}
          labels={labels}
          className="border-t border-line/70 @6xl/page:border-l @6xl/page:border-t-0"
        />
      </div>
      <p className="shrink-0 truncate border-t border-line/70 px-3 py-1.5 text-[9px] text-muted" title={policy}>{policy}</p>
    </CockpitPanel>
  );
}

function teacherCapacityRows(rows: StaffOverviewTeacherRow[]): CapacityVisualDatum[] {
  return rows.map((row) => ({
    key: row.userId,
    label: row.name,
    classCount: row.classCount,
    fullSeats: row.fullSeats,
    enrolledSeats: row.enrolledSeats,
    minimumOpenGap: row.minimumOpenGap,
    healthyDelta: row.healthyDelta,
    remainingSeats: row.remainingSeats,
  }));
}

function gradeCapacityRows(
  rows: StaffOverviewCapacityRow[],
  gradeLabel: (row: StaffOverviewCapacityRow) => string,
): CapacityVisualDatum[] {
  return rows.map((row) => ({
    key: row.key,
    label: gradeLabel(row),
    classCount: row.classCount,
    fullSeats: row.fullSeats,
    enrolledSeats: row.enrolledSeats,
    minimumOpenGap: row.minimumOpenGap,
    healthyDelta: row.healthyDelta,
    remainingSeats: row.remainingSeats,
  }));
}

export async function StaffFactOverviewHome({
  locale,
  focusTarget,
  grain,
  workItemCount,
}: HomeProps & {
  focusTarget?: string;
  grain: StaffOverviewGrain;
  workItemCount: number;
}) {
  const [t, hubT, data] = await Promise.all([
    getTranslations("school.home.overview"),
    getTranslations("school.home.staffHub"),
    getStaffOverviewData({ grain }),
  ]);
  const currentRange = rangeLabel(locale, data.timeZone, data.currentStart, data.currentCutoff);
  const previousRange = rangeLabel(locale, data.timeZone, data.previousStart, data.previousCutoff);
  const generatedAt = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: data.timeZone,
  }).format(new Date(data.generatedAt));
  const sourceNames = (sources: StaffOverviewSourceKey[]) => sources.map((source) => t(`source_${source}`)).join(t("listSeparator"));
  const limitedSources = Array.from(new Set([...data.unavailableSources, ...data.truncatedSources]));
  const sourceDetail = [
    data.unavailableSources.length > 0 ? t("unavailableSources", { sources: sourceNames(data.unavailableSources) }) : null,
    data.truncatedSources.length > 0 ? t("truncatedSources", { sources: sourceNames(data.truncatedSources), limit: 10000 }) : null,
  ].filter(Boolean).join("；");
  const metricLabels = Object.fromEntries(STAFF_OVERVIEW_METRICS.map((metric) => [metric, t(`fact_${metric}`)])) as MetricLabels;
  const periodTabs = (["week", "month"] as const).map((value) => ({
    value,
    label: t(`period_${value}`),
    href: periodHref(value),
  }));
  const snapshotItems = [
    { label: t("snapshotActiveStudents"), value: valueOrDash(data.snapshot.activeStudents), note: t("snapshotActiveStudentsNote") },
    { label: t("snapshotActiveClasses"), value: valueOrDash(data.snapshot.activeClasses), note: t("snapshotActiveClassesNote") },
    { label: t("snapshotEnrolledSeats"), value: valueOrDash(data.snapshot.enrolledSeats), note: t("snapshotEnrolledSeatsNote") },
    { label: t("snapshotHealthyDelta"), value: signedOrDash(data.snapshot.healthyDelta), note: t("snapshotHealthyDeltaNote") },
    { label: t("snapshotRemainingSeats"), value: valueOrDash(data.snapshot.remainingSeats), note: t("snapshotRemainingSeatsNote") },
  ];
  const capacityLabels = {
    classes: t("shortClasses"),
    minimum: t("shortMinimumGap"),
    healthy: t("shortHealthy"),
    remaining: t("shortRemaining"),
  };

  return (
    <DashboardPage
      title={t("title")}
      eyebrow={t("eyebrow")}
      meta={(
        <>
          <span>{t("currentPeriod")} {currentRange}</span>
          <span aria-hidden>·</span>
          <span>{t("previousPeriod")} {previousRange}</span>
          <span aria-hidden>·</span>
          <span>{t("generatedAt")} {generatedAt}</span>
          <Badge variant={limitedSources.length > 0 ? "outline" : "secondary"} title={sourceDetail || t("allSourcesAvailable")}>
            {limitedSources.length > 0 ? t("dataLimitedShort", { count: limitedSources.length }) : t("dataReadyShort")}
          </Badge>
        </>
      )}
      density="compact"
      commandPanel={(
        <DashboardCommandPanel className="min-h-12 py-1.5">
          <DashboardCommandState>
            <StaffHomeViewTabs
              activeView="overview"
              period={grain}
              workItemCount={workItemCount}
              ariaLabel={hubT("viewAriaLabel")}
              workLabel={hubT("workView")}
              overviewLabel={hubT("overviewView")}
            />
            <span aria-hidden className="hidden h-6 w-px bg-line @xl/page:block" />
            <DashboardCommandTabs items={periodTabs} activeValue={grain} ariaLabel={t("periodAriaLabel")} />
          </DashboardCommandState>
        </DashboardCommandPanel>
      )}
      bodyClassName="pb-3"
      contentClassName="min-h-0"
    >
      <div className="space-y-2">
        <NotificationFocus target={focusTarget} />

        <BusinessFactBand
          facts={data.businessFacts}
          title={t("businessFactsTitle")}
          labels={metricLabels}
          currentLabel={t("currentShort")}
          previousLabel={t("previousShort")}
          differenceLabel={t("differenceColumn")}
        />

        <PendingStrip
          facts={data.pendingFacts}
          title={t("pendingTitle")}
          countLabel={t("recordCount", { count: data.pendingFacts.length })}
          shortLabel={(key) => t(`pendingShort_${key}`)}
          fullLabel={(key) => t(`pending_${key}`)}
        />

        <div className="grid min-w-0 gap-3 @4xl/page:h-[calc(100dvh-21rem)] @4xl/page:min-h-[24rem] @4xl/page:max-h-[44rem] @4xl/page:grid-cols-[minmax(0,1.55fr)_minmax(23rem,1fr)]">
          <SupportFunnelPanel
            rows={data.supportFunnelRows}
            title={t("supportFunnelTitle")}
            metricLabels={metricLabels}
            currentLabel={t("currentShort")}
            previousLabel={t("previousShort")}
            differenceLabel={t("differenceColumn")}
            peopleLabel={t("peopleCount", { count: data.supportFunnelRows.length })}
            personLabel={t("role_learningSupport")}
            unassignedLabel={t("unassignedPerson")}
            attributionNote={t("supportFunnelAttributionNote")}
            emptyLabel={t("supportFunnelEmpty")}
          />

          <div className="grid min-h-0 min-w-0 gap-3 @4xl/page:grid-rows-[minmax(15rem,.78fr)_minmax(20rem,1.22fr)]">
            <TeacherOutcomePanel
              title={t("teacherOutcomeTitle")}
              rows={data.teacherParticipationRows}
              summary={data.teacherParticipationSummary}
              currentLabel={t("currentShort")}
              previousLabel={t("previousShort")}
              peopleLabel={t("teacherParticipantCount", { count: data.teacherParticipationRows.length })}
              participantLabel={t("teacherParticipants")}
              enrollmentLabel={t("teacherEnrollments")}
              conversionLabel={t("teacherConversion")}
              unattributedLabel={t("teacherUnattributed")}
              note={t("teacherOutcomeNote")}
              emptyLabel={t("teacherOutcomeEmpty")}
            />

            <CapacityPanel
              title={t("capacityTitle")}
              snapshotItems={snapshotItems}
              teachers={teacherCapacityRows(data.teacherRows)}
              grades={gradeCapacityRows(
                data.capacityByGrade,
                (row) => row.grade === null ? t("unknownGrade") : t("gradeValue", { grade: row.grade }),
              )}
              teacherTitle={t("capacityByTeacher")}
              gradeTitle={t("capacityByGrade")}
              teacherEmpty={t("teacherEmpty")}
              gradeEmpty={data.capacityAvailable ? t("capacityEmpty") : t("capacityUnavailable")}
              labels={capacityLabels}
              legendEnrolled={t("capacityLegendEnrolled")}
              legendHealthy={t("capacityLegendHealthy")}
              policy={t("capacityPolicyCompact")}
            />
          </div>
        </div>
      </div>
    </DashboardPage>
  );
}
