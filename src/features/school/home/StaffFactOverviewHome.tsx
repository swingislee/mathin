import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StaffOverviewSupportPicker } from "./StaffOverviewSupportPicker";
import { StaffOverviewCapacityTabs } from "./StaffOverviewCapacityTabs";
import { selectOverviewSupportRows, staffOverviewSupportCookie } from "./staff-overview-display-contract";
import { ArrowUpRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { NotificationFocus } from "@/features/events/NotificationFocus";
import {
  DashboardCommandActions,
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
} from "@/features/school/dashboard-page";
import { ObjectBar, ObjectWorkspace } from "@/features/school/object-workspace";
import { calendarDayKey } from "@/features/school/schedule";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { HomeProps } from "./shared";
import { staffHomeHref } from "./staff-home-contract";
import { StaffHomeViewTabs } from "./StaffHomeViewTabs";
import { StaffOverviewDataNote } from "./StaffOverviewDataNote";
import { StaffOverviewPeriodPicker } from "./StaffOverviewPeriodPicker";
import { StaffOverviewRefreshButton } from "./StaffOverviewRefreshButton";
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
  buildStaffOverviewWindow,
  type StaffOverviewGrain,
  type StaffOverviewMetric,
  type StaffOverviewTrendPoint,
} from "./staff-overview-contract";

type MetricLabels = Record<StaffOverviewMetric, string>;

function ScopeTitle({ label, children, current = false }: { label: string; children: ReactNode; current?: boolean }) {
  return <span className="inline-flex min-w-0 items-center gap-2">
    <Badge variant="outline" className={cn("shrink-0 px-1.5 py-0 text-[9px]", current ? "border-leaf-deep/25 bg-leaf/15 text-leaf-deep" : "border-crater/30 bg-moon/25 text-muted")}>{label}</Badge>
    <span className="min-w-0 truncate">{children}</span>
  </span>;
}

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

function rangeLabel(locale: string, timeZone: string, start: string, cutoff: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone });
  return formatter.formatRange(new Date(start), new Date(Math.max(new Date(start).getTime(), new Date(cutoff).getTime() - 1)));
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
  title: ReactNode;
  labels: MetricLabels;
  currentLabel: string;
  previousLabel: string;
  differenceLabel: string;
}) {
  return (
    <section aria-labelledby="staff-overview-business-facts" data-overview-scope="period">
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
  title: ReactNode;
  countLabel: string;
  shortLabel: (key: string) => string;
  fullLabel: (key: string) => string;
}) {
  return (
    <section
      aria-labelledby="staff-overview-pending"
      data-overview-scope="current"
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
  timeScope,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  timeScope: "period" | "current";
}) {
  return (
    <section data-overview-scope={timeScope} className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line/80 bg-card/90", className)}>
      <header className="flex min-h-11 shrink-0 min-w-0 items-center justify-between gap-3 border-b border-line/70 px-3">
        <h2 className="min-w-0 truncate text-sm font-medium text-ink">{title}</h2>
        {meta ? <div className="shrink-0 text-[10px] text-muted">{meta}</div> : null}
      </header>
      <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

function PersonComparisonCell({ value, previousLabel }: { value: StaffOverviewPersonMetric; previousLabel: string }) {
  return <span className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap tabular-nums" title={previousLabel}>
    <strong className="text-sm font-medium text-ink">{valueOrDash(value.current)}</strong>
    <span className="text-[10px] text-muted">/ {valueOrDash(value.previous)}</span>
  </span>;
}

function SupportFunnelPanel({ rows, title, metricLabels, currentLabel, previousLabel, peopleLabel, personLabel, unassignedLabel, otherLabel, attributionNote, emptyLabel }: {
  rows: StaffOverviewSupportFunnelRow[]; title: ReactNode; metricLabels: MetricLabels; currentLabel: string;
  previousLabel: string; peopleLabel: string; personLabel: string; unassignedLabel: string; otherLabel: string; attributionNote: string; emptyLabel: string;
}) {
  return <CockpitPanel timeScope="period" title={title} meta={peopleLabel}
    className="min-h-64 @4xl/page:col-span-2 @6xl/page:col-span-1" bodyClassName="flex min-h-0 flex-col">
    <p className="shrink-0 px-3 py-1.5 text-[10px] text-muted">{currentLabel} / {previousLabel}</p>
    <Table containerClassName="min-h-0 flex-1 overflow-auto" className="min-w-[29rem] text-xs">
      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
        <TableHead className="h-8 w-24 px-3 text-[10px]">{personLabel}</TableHead>
        {STAFF_OVERVIEW_METRICS.map(metric => <TableHead key={metric} className="h-8 px-1.5 text-right text-[10px] whitespace-nowrap">{metricLabels[metric]}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.key} data-support-row={row.key}>
        <TableCell className="max-w-28 truncate px-3 py-1.5 font-medium" title={row.name || (row.key === "__other__" ? otherLabel : unassignedLabel)}>{row.name || (row.key === "__other__" ? otherLabel : unassignedLabel)}</TableCell>
        {STAFF_OVERVIEW_METRICS.map(metric => <TableCell key={metric} className="px-1.5 py-1.5 text-right"><PersonComparisonCell value={row.metrics[metric]} previousLabel={previousLabel} /></TableCell>)}
      </TableRow>)}</TableBody>
    </Table>
    {rows.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">{emptyLabel}</p> : null}
    <p className="shrink-0 border-t border-line/70 px-3 py-1.5 text-[10px] leading-4 text-muted">{attributionNote}</p>
  </CockpitPanel>;
}

function percentage(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null || denominator === 0) return "—";
  return `${Math.round(numerator / denominator * 100)}%`;
}



function TeacherOutcomePanel({
  title,
  rows,
  summary,
  currentLabel,
  previousLabel,
  peopleLabel,
  teacherLabel,
  participantLabel,
  enrollmentLabel,
  conversionLabel,
  unattributedLabel,
  note,
  emptyLabel,
}: {
  title: ReactNode;
  rows: StaffOverviewTeacherParticipationRow[];
  summary: StaffOverviewTeacherParticipationSummary;
  currentLabel: string;
  previousLabel: string;
  peopleLabel: string;
  teacherLabel: string;
  participantLabel: string;
  enrollmentLabel: string;
  conversionLabel: string;
  unattributedLabel: string;
  note: string;
  emptyLabel: string;
}) {

  return (
    <CockpitPanel
      timeScope="period"
      title={title}
      meta={peopleLabel}
      className="min-h-64"
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
      <Table containerClassName="min-h-0 flex-1 overflow-auto" className="text-xs">
        <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
          <TableHead className="h-8 px-3 text-[10px]">{teacherLabel}</TableHead>
          <TableHead className="h-8 px-2 text-right text-[10px]">{participantLabel}</TableHead>
          <TableHead className="h-8 px-2 text-right text-[10px]">{enrollmentLabel}</TableHead>
          <TableHead className="h-8 px-2 text-right text-[10px]">{conversionLabel}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => <TableRow key={row.userId}>
          <TableCell className="max-w-24 truncate px-3 py-1.5 font-medium" title={row.name}>{row.name}</TableCell>
          <TableCell className="px-2 py-1.5 text-right"><PersonComparisonCell value={row.participants} previousLabel={previousLabel} /></TableCell>
          <TableCell className="px-2 py-1.5 text-right"><PersonComparisonCell value={row.enrollments} previousLabel={previousLabel} /></TableCell>
          <TableCell className="px-2 py-1.5 text-right text-[11px] tabular-nums">{percentage(row.enrollments.current, row.participants.current)}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
      {rows.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">{emptyLabel}</p> : null}
      <p className="shrink-0 border-t border-line/70 px-3 py-1.5 text-[9px] leading-4 text-muted">{note}</p>
    </CockpitPanel>
  );
}

function CapacityGroup({ title, rows, emptyLabel, labels }: {
  title: string; rows: CapacityVisualDatum[]; emptyLabel: string;
  labels: { classes: string; minimum: string; healthy: string; remaining: string; enrolled: string };
}) {
  return <>
    <Table containerClassName="min-h-0 flex-1 overflow-auto" className="text-xs">
      <TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
        {[title, labels.classes, labels.enrolled, labels.minimum, labels.healthy, labels.remaining].map((label, i) =>
          <TableHead key={label} className={cn("h-8 px-2 text-[10px] whitespace-nowrap", i > 0 && "text-right")}>{label}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.key}>
        <TableCell className="max-w-24 truncate px-2 py-1.5 font-medium" title={row.label}>{row.label}</TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{valueOrDash(row.classCount)}</TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{valueOrDash(row.enrolledSeats)}<span className="text-[10px] text-muted">/{valueOrDash(row.fullSeats)}</span></TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{valueOrDash(row.minimumOpenGap)}</TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{signedOrDash(row.healthyDelta)}</TableCell>
        <TableCell className="px-2 py-1.5 text-right tabular-nums">{valueOrDash(row.remainingSeats)}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
    {rows.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">{emptyLabel}</p> : null}
  </>;
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
  policy,
}: {
  title: ReactNode;
  snapshotItems: Array<{ label: string; value: string; note: string }>;
  teachers: CapacityVisualDatum[];
  grades: CapacityVisualDatum[];
  teacherTitle: string;
  gradeTitle: string;
  teacherEmpty: string;
  gradeEmpty: string;
  labels: { classes: string; minimum: string; healthy: string; remaining: string; enrolled: string };
  policy: string;
}) {
  return (
    <CockpitPanel
      timeScope="current"
      title={title}
      className="min-h-64"
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="grid shrink-0 grid-cols-2 border-b border-line/70">
        {snapshotItems.map((item, index) => (
          <dl
            key={item.label}
            className={cn(
              "flex min-w-0 items-center justify-between gap-2 px-2.5 py-2",
              index > 0 && "border-l border-line/55",
              index === snapshotItems.length - 1 && "col-span-2",
            )}
            title={item.note}
          >
            <dt className="truncate text-[9px] text-muted">{item.label}</dt>
            <dd className="shrink-0 font-display text-base leading-none tabular-nums text-ink">{item.value}</dd>
          </dl>
        ))}
      </div>
      <StaffOverviewCapacityTabs teacherLabel={teacherTitle + " · " + teachers.length} gradeLabel={gradeTitle + " · " + grades.length}
        teachers={<CapacityGroup title={teacherTitle} rows={teachers} emptyLabel={teacherEmpty} labels={labels} />}
        grades={<CapacityGroup title={gradeTitle} rows={grades} emptyLabel={gradeEmpty} labels={labels} />} />
      <p className="shrink-0 truncate border-t border-line/70 px-3 py-1.5 text-[9px] text-muted" title={policy}>{policy}</p>
    </CockpitPanel>
  );
}

function teacherCapacityRows(rows: StaffOverviewTeacherRow[]): CapacityVisualDatum[] {
  return rows.filter(row => row.classCount === null || row.classCount > 0).map((row) => ({
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
  user,
  profile,
  focusTarget,
  grain,
  date,
  workItemCount,
}: HomeProps & {
  focusTarget?: string;
  grain: StaffOverviewGrain;
  date: string;
  workItemCount: number;
}) {
  const [schoolT, t, hubT, data] = await Promise.all([
    getTranslations("school"),
    getTranslations("school.home.overview"),
    getTranslations("school.home.staffHub"),
    getStaffOverviewData({ grain, date }),
  ]);
  const supportCookie = staffOverviewSupportCookie(user.id);
  const rememberedSupport = (await cookies()).get(supportCookie)?.value;
  const supportDisplay = selectOverviewSupportRows(data.supportFunnelRows, data.supportDirectory, rememberedSupport);
  const currentRange = rangeLabel(locale, data.timeZone, data.currentStart, data.currentCutoff);
  const previousRange = rangeLabel(locale, data.timeZone, data.previousStart, data.previousCutoff);
  const dayKey = (value: string) => calendarDayKey(new Date(value), data.timeZone);
  const selectedDate = dayKey(data.currentStart);
  const selection = date === "current" || date === "previous" ? date : selectedDate;
  const liveWindow = buildStaffOverviewWindow(grain, new Date(data.generatedAt), data.timeZone);
  const previousLabel = t(data.isComplete ? "previousComplete" : "previousShort");
  const generatedAt = new Intl.DateTimeFormat(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: data.timeZone,
  }).format(new Date(data.generatedAt));
  const dateLine = new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeZone: data.timeZone,
  }).format(new Date(data.generatedAt));
  const greeting = schoolT("home.staffGreeting", { name: profile?.displayName || "" });
  const sourceNames = (sources: StaffOverviewSourceKey[]) => sources.map((source) => t(`source_${source}`)).join(t("listSeparator"));
  const limitedSources = Array.from(new Set([...data.unavailableSources, ...data.truncatedSources]));
  const missingDates = STAFF_OVERVIEW_METRICS.filter(metric => (data.missingDateCounts[metric] ?? 0) > 0)
    .map(metric => t("missingDateMetric", { metric: t(`fact_${metric}`), count: data.missingDateCounts[metric]! }));
  const sourceDetail = [
    data.unavailableSources.length > 0 ? t("unavailableSources", { sources: sourceNames(data.unavailableSources) }) : null,
    data.truncatedSources.length > 0 ? t("truncatedSources", { sources: sourceNames(data.truncatedSources), limit: 10000 }) : null,
    missingDates.length > 0 ? t("missingDateSources", { sources: missingDates.join(t("listSeparator")) }) : null,
    t("businessFactBasis"),
  ].filter(Boolean).join("；");
  const metricLabels = Object.fromEntries(STAFF_OVERVIEW_METRICS.map((metric) => [metric, t(`fact_${metric}`)])) as MetricLabels;
  const periodTabs = (["week", "month"] as const).map((value) => ({
    value,
    label: t(`period_${value}`),
    href: staffHomeHref("overview", value, selection),
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
    enrolled: t("capacitySeatsColumn"),
    minimum: t("shortMinimumGap"),
    healthy: t("shortHealthy"),
    remaining: t("shortRemaining"),
  };

  return (
    <ObjectWorkspace
      objectBar={(
        <ObjectBar
          title={greeting}
          context={[{ value: hubT("overviewView") }, { value: dateLine }]}
        />
      )}
      commandPanel={(
        <DashboardCommandPanel className="min-h-12 py-1.5">
          <DashboardCommandState>
            <StaffHomeViewTabs
              activeView="overview"
              period={grain}
              date={selection}
              workItemCount={workItemCount}
              ariaLabel={hubT("viewAriaLabel")}
              workLabel={hubT("workView")}
              overviewLabel={hubT("overviewView")}
            />
            <span aria-hidden className="hidden h-6 w-px bg-line @xl/page:block" />
            <DashboardCommandTabs items={periodTabs} activeValue={grain} ariaLabel={t("periodAriaLabel")} />
            <StaffOverviewPeriodPicker
              key={`${grain}:${selection}:${selectedDate}`}
              grain={grain} selection={selection} selectedDate={selectedDate} today={dayKey(data.generatedAt)}
              range={grain === "month"
                ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: data.timeZone }).format(new Date(data.currentStart))
                : rangeLabel(locale, data.timeZone, data.currentStart, data.currentEnd)}
              previousDate={dayKey(data.previousStart)} nextDate={data.isComplete ? dayKey(data.currentEnd) : null}
              isPrevious={data.currentEnd === liveWindow.currentStart.toISOString()}
            />
          </DashboardCommandState>
          <DashboardCommandActions>
            <StaffOverviewSupportPicker key={rememberedSupport ?? "default"} options={supportDisplay.options} selectedIds={supportDisplay.selectedIds} cookieName={supportCookie} />
            <span className="text-[10px] tabular-nums text-muted">{t("updatedAt", { time: generatedAt })}</span>
            <StaffOverviewRefreshButton />
            <StaffOverviewDataNote
              triggerLabel={t("dataNoteTrigger")}
              title={t("dataNoteTitle")}
              rows={[
                { label: t("selectedPeriod"), value: currentRange },
                { label: previousLabel, value: previousRange },
                { label: t("currentSchoolTerm"), value: data.currentTermName ?? t("unknownSchoolTerm") },
                { label: t("generatedAt"), value: generatedAt },
              ]}
              status={limitedSources.length > 0 ? t("dataLimitedShort", { count: limitedSources.length }) : missingDates.length > 0 ? t("dataDatesPending") : t("dataReadyShort")}
              statusDetail={sourceDetail || t("allSourcesAvailable")}
              limited={limitedSources.length > 0 || missingDates.length > 0}
            />
          </DashboardCommandActions>
        </DashboardCommandPanel>
      )}
      density="compact"
    >
      <div className="min-h-0 space-y-2 pb-3">
        <NotificationFocus target={focusTarget} />
        <p className="text-[10px] text-muted" data-overview-comparison={data.isComplete ? "complete" : "to-date"}>
          {t(data.isComplete ? "completeComparison" : "progressComparison", { current: currentRange, previous: previousRange })}
        </p>

        <BusinessFactBand
          facts={data.businessFacts}
          title={<ScopeTitle label={t("periodScope")}>{t("businessFactsTitle")}</ScopeTitle>}
          labels={metricLabels}
          currentLabel={t("currentShort")}
          previousLabel={previousLabel}
          differenceLabel={t("differenceColumn")}
        />

        <PendingStrip
          facts={data.pendingFacts}
          title={<ScopeTitle label={t("currentScope")} current>{t("pendingRecordsTitle")}</ScopeTitle>}
          countLabel={t("recordCount", { count: data.pendingFacts.length })}
          shortLabel={(key) => t(`pendingShort_${key}`)}
          fullLabel={(key) => t(`pending_${key}`)}
        />

        <div className="grid min-w-0 gap-2 @4xl/page:grid-cols-2 @6xl/page:h-[calc(100dvh-20rem)] @6xl/page:min-h-[23rem] @6xl/page:max-h-[48rem] @6xl/page:grid-cols-[minmax(29rem,1.35fr)_minmax(17rem,.8fr)_minmax(24rem,1.05fr)]">
          <SupportFunnelPanel
            rows={supportDisplay.rows}
            title={<ScopeTitle label={t("periodScope")}>{t("supportFunnelTitle")}</ScopeTitle>}
            metricLabels={metricLabels}
            currentLabel={t("currentShort")}
            previousLabel={previousLabel}
            peopleLabel={t("peopleCount", { count: supportDisplay.selectedIds.length })}
            personLabel={t("role_learningSupport")}
            unassignedLabel={t("unassignedPerson")}
            otherLabel={t("otherStaff")}
            attributionNote={t("supportDisplayFootnote")}
            emptyLabel={t("supportFunnelEmpty")}
          />


            <TeacherOutcomePanel
              title={<ScopeTitle label={t("periodScope")}>{t("teacherOutcomeTitle")}</ScopeTitle>}
              rows={data.teacherParticipationRows}
              summary={data.teacherParticipationSummary}
              currentLabel={t("currentShort")}
              previousLabel={previousLabel}
              peopleLabel={t("teacherParticipantCount", { count: data.teacherParticipationRows.length })}
              teacherLabel={t("role_teacher")}
              participantLabel={t("teacherParticipants")}
              enrollmentLabel={t("teacherEnrollments")}
              conversionLabel={t("teacherConversion")}
              unattributedLabel={t("teacherUnattributed")}
              note={t("teacherOutcomeNote")}
              emptyLabel={t("teacherOutcomeEmpty")}
            />

            <CapacityPanel
              title={<ScopeTitle label={t("currentScope")} current>{t("capacityTermTitle", { term: data.currentTermName ?? t("unknownSchoolTerm") })}</ScopeTitle>}
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
              policy={t("capacityPolicyCompact")}
            />
        </div>
      </div>
    </ObjectWorkspace>
  );
}
