import { ArrowUpRight, CircleAlert, Database, GitBranch, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardEmptyCard,
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
  type StatusStripItem,
} from "@/features/school/dashboard-page";
import {
  getManagementAnalyticsData,
  type ManagementAnalyticsBreakdownRow,
  type ManagementAnalyticsClassAttendanceRow,
  type ManagementAnalyticsData,
  type ManagementAnalyticsSourceKey,
} from "@/features/school/management-analytics";
import {
  MANAGEMENT_FUNNEL_STAGES,
  type ManagementAnalyticsGrain,
  type ManagementAnalyticsSourceAccess,
  type ManagementFunnelStage,
  type ManagementMetricDto,
} from "@/features/school/management-analytics-contract";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

function valueOrDash(value: number | null, formatter: Intl.NumberFormat): string {
  return value === null ? "—" : formatter.format(value);
}

function percentOrDash(value: number | null, formatter: Intl.NumberFormat): string {
  return value === null ? "—" : formatter.format(value);
}

function MetricRate({
  metric,
  percentFormatter,
  unavailableLabel,
}: {
  metric: ManagementMetricDto;
  percentFormatter: Intl.NumberFormat;
  unavailableLabel: string;
}) {
  const percent = percentOrDash(metric.rate, percentFormatter);
  return (
    <div
      className="min-w-24"
      title={`${metric.eventTimeField} · ${metric.attributionRule}`}
      aria-label={metric.rate === null ? unavailableLabel : percent}
    >
      <div className="flex items-center justify-between gap-2 tabular-nums">
        <span className={cn("font-medium", metric.rate === null ? "text-muted" : "text-ink")}>{percent}</span>
        {metric.unresolvedCount ? (
          <span className="text-[10px] text-amber-700 dark:text-amber-300">+{metric.unresolvedCount}</span>
        ) : null}
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/55" aria-hidden>
        <span
          className="block h-full rounded-full bg-ink/70"
          style={{ width: `${Math.max(0, Math.min(100, (metric.rate ?? 0) * 100))}%` }}
        />
      </div>
    </div>
  );
}

function stageHref(stage: ManagementFunnelStage): string {
  if (stage === "invitations") return "/dashboard/invitations";
  if (stage === "arrivals") return "/dashboard/activities";
  if (stage === "assessments") return "/dashboard/assessments";
  return "/dashboard/leads?scope=all";
}

function FunnelTable({
  data,
  labels,
  numberFormatter,
  percentFormatter,
}: {
  data: ManagementAnalyticsData;
  labels: {
    stage: string;
    current: string;
    currentRate: string;
    previous: string;
    unresolved: string;
    trace: string;
    unavailable: string;
    stages: Record<ManagementFunnelStage, string>;
  };
  numberFormatter: Intl.NumberFormat;
  percentFormatter: Intl.NumberFormat;
}) {
  return (
    <DashboardTableShell>
      <Table className="min-w-[50rem]">
        <TableHeader>
          <TableRow>
            <TableHead>{labels.stage}</TableHead>
            <TableHead className="text-right">{labels.current}</TableHead>
            <TableHead>{labels.currentRate}</TableHead>
            <TableHead className="text-right">{labels.previous}</TableHead>
            <TableHead className="text-right">{labels.unresolved}</TableHead>
            <TableHead className="text-right">{labels.trace}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {MANAGEMENT_FUNNEL_STAGES.map((stage) => {
            const current = data.funnel.current[stage];
            const previous = data.funnel.previous[stage];
            return (
              <TableRow key={stage}>
                <TableCell>
                  <div className="font-medium text-ink">{labels.stages[stage]}</div>
                  <div className="mt-0.5 max-w-96 truncate font-mono text-[10px] text-muted" title={current.eventTimeField}>
                    {current.eventTimeField}
                  </div>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {valueOrDash(current.numerator, numberFormatter)}
                </TableCell>
                <TableCell>
                  {stage === "leads" ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    <MetricRate metric={current} percentFormatter={percentFormatter} unavailableLabel={labels.unavailable} />
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted">
                  {valueOrDash(previous.numerator, numberFormatter)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {valueOrDash(current.unresolvedCount, numberFormatter)}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={stageHref(stage)} className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">
                    {labels.trace}<ArrowUpRight className="size-3" aria-hidden />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function BreakdownTable({
  rows,
  labels,
  numberFormatter,
  percentFormatter,
}: {
  rows: readonly ManagementAnalyticsBreakdownRow[];
  labels: {
    name: string;
    leads: string;
    contacts: string;
    arrivals: string;
    assessments: string;
    conversion: string;
    empty: string;
    unknown: string;
    fallback: string;
    trace: string;
    unavailable: string;
  };
  numberFormatter: Intl.NumberFormat;
  percentFormatter: Intl.NumberFormat;
}) {
  if (rows.length === 0) return <DashboardEmptyCard>{labels.empty}</DashboardEmptyCard>;
  return (
    <DashboardTableShell>
      <Table className="min-w-[48rem]">
        <TableHeader>
          <TableRow>
            <TableHead>{labels.name}</TableHead>
            <TableHead className="text-right">{labels.leads}</TableHead>
            <TableHead className="text-right">{labels.contacts}</TableHead>
            <TableHead className="text-right">{labels.arrivals}</TableHead>
            <TableHead className="text-right">{labels.assessments}</TableHead>
            <TableHead>{labels.conversion}</TableHead>
            <TableHead className="text-right">{labels.fallback}</TableHead>
            <TableHead className="text-right">{labels.trace}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 100).map((row) => (
            <TableRow key={row.key}>
              <TableCell className="max-w-56">
                <div className="truncate font-medium text-ink">{row.label || labels.unknown}</div>
                {row.detail ? <div className="mt-0.5 truncate text-[10px] text-muted" title={row.detail}>{row.detail}</div> : null}
              </TableCell>
              {(["leads", "contacts", "arrivals", "assessments"] as const).map((stage) => (
                <TableCell key={stage} className="text-right tabular-nums">
                  {valueOrDash(row.current[stage].numerator, numberFormatter)}
                </TableCell>
              ))}
              <TableCell>
                <MetricRate metric={row.current.assessments} percentFormatter={percentFormatter} unavailableLabel={labels.unavailable} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums text-muted">
                {valueOrDash(row.currentFallback.leads, numberFormatter)}
              </TableCell>
              <TableCell className="text-right">
                <Link href="/dashboard/leads?scope=all" className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">
                  {labels.trace}<ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function ClassAttendanceTable({
  rows,
  labels,
  locale,
  timeZone,
  numberFormatter,
  percentFormatter,
}: {
  rows: readonly ManagementAnalyticsClassAttendanceRow[];
  labels: Record<"session" | "expected" | "recorded" | "attended" | "rate" | "missing" | "unexpected" | "trace" | "empty" | "untitled" | "unavailable", string>;
  locale: string;
  timeZone: string;
  numberFormatter: Intl.NumberFormat;
  percentFormatter: Intl.NumberFormat;
}) {
  if (rows.length === 0) return <DashboardEmptyCard>{labels.empty}</DashboardEmptyCard>;
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone });
  return (
    <DashboardTableShell>
      <Table className="min-w-[52rem]">
        <TableHeader>
          <TableRow>
            <TableHead>{labels.session}</TableHead>
            <TableHead className="text-right">{labels.expected}</TableHead>
            <TableHead className="text-right">{labels.recorded}</TableHead>
            <TableHead className="text-right">{labels.attended}</TableHead>
            <TableHead>{labels.rate}</TableHead>
            <TableHead className="text-right">{labels.missing}</TableHead>
            <TableHead className="text-right">{labels.unexpected}</TableHead>
            <TableHead className="text-right">{labels.trace}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <div className="font-medium text-ink">{row.title || labels.untitled}</div>
                <div className="mt-0.5 text-xs text-muted">{dateFormatter.format(new Date(row.scheduledAt))}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{numberFormatter.format(row.expected)}</TableCell>
              <TableCell className="text-right tabular-nums">{numberFormatter.format(row.recorded)}</TableCell>
              <TableCell className="text-right tabular-nums">{numberFormatter.format(row.attended)}</TableCell>
              <TableCell><MetricRate metric={row.metric} percentFormatter={percentFormatter} unavailableLabel={labels.unavailable} /></TableCell>
              <TableCell className={cn("text-right tabular-nums", row.missing > 0 && "text-amber-700 dark:text-amber-300")}>{numberFormatter.format(row.missing)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", row.unexpected > 0 && "text-rose")}>{numberFormatter.format(row.unexpected)}</TableCell>
              <TableCell className="text-right">
                <Link href={row.href} className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">
                  {labels.trace}<ArrowUpRight className="size-3" aria-hidden />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}

function sourceList(
  values: readonly ManagementAnalyticsSourceKey[],
  label: (key: ManagementAnalyticsSourceKey) => string,
): string {
  return values.map(label).join(" · ");
}

export async function ManagementAnalyticsDashboard({
  locale,
  grain,
  sourceAccess,
}: {
  locale: string;
  grain: ManagementAnalyticsGrain;
  sourceAccess: ManagementAnalyticsSourceAccess;
}) {
  const [t, data] = await Promise.all([
    getTranslations("school.managementAnalytics"),
    getManagementAnalyticsData({ grain, sourceAccess }),
  ]);
  const numberFormatter = new Intl.NumberFormat(locale);
  const percentFormatter = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: data.timeZone });
  const rangeFormatter = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", timeZone: data.timeZone });
  const currentRange = `${rangeFormatter.format(new Date(data.currentStart))}–${rangeFormatter.format(new Date(data.currentCutoff))}`;
  const previousRange = `${rangeFormatter.format(new Date(data.previousStart))}–${rangeFormatter.format(new Date(data.previousCutoff))}`;
  const sourceIssueCount = data.unavailableSources.length + data.truncatedSources.length;
  const activityKindLabels: Record<string, string> = {
    trial_class: t("activityKind_trial_class"),
    assessment_1v1: t("activityKind_assessment_1v1"),
    sanbanfu: t("activityKind_sanbanfu"),
    lecture: t("activityKind_lecture"),
    competition: t("activityKind_competition"),
    public_class: t("activityKind_public_class"),
  };
  const statusItems: StatusStripItem[] = [
    {
      label: t("summaryAssessmentConversion"),
      value: percentOrDash(data.funnel.current.assessments.rate, percentFormatter),
    },
    {
      label: t("summaryActivityAttendance"),
      value: percentOrDash(data.activityTotals.current.attendance.rate, percentFormatter),
    },
    {
      label: t("summaryClassAttendance"),
      value: percentOrDash(data.classAttendanceTotals.current.metric.rate, percentFormatter),
    },
    {
      label: t("summaryOverdueReminders"),
      value: valueOrDash(data.backlog.overdueReminders.numerator, numberFormatter),
      tone: (data.backlog.overdueReminders.numerator ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: t("summaryDataSources"),
      value: sourceIssueCount === 0 ? t("sourcesReady") : t("sourcesLimited", { count: sourceIssueCount }),
      tone: sourceIssueCount === 0 ? "default" : "warning",
    },
  ];
  const stageLabels = Object.fromEntries(MANAGEMENT_FUNNEL_STAGES.map((stage) => [stage, t(`stage_${stage}`)])) as Record<ManagementFunnelStage, string>;
  const commonBreakdownLabels = {
    leads: t("stage_leads"),
    contacts: t("stage_contacts"),
    arrivals: t("stage_arrivals"),
    assessments: t("stage_assessments"),
    conversion: t("assessmentConversion"),
    fallback: t("fallbackCount"),
    trace: t("trace"),
    unavailable: t("unavailable"),
  };

  return (
    <DashboardPage
      eyebrow={t("eyebrow")}
      title={t("title")}
      description={t("description")}
      meta={<Badge variant="outline">{t("availableSlice")}</Badge>}
      commandPanel={(
        <DashboardCommandPanel>
          <DashboardCommandState>
            <DashboardCommandTabs
              ariaLabel={t("periodAriaLabel")}
              activeValue={grain}
              items={(["week", "month"] as const).map((value) => ({
                value,
                label: t(`period_${value}`),
                href: `/dashboard/management-analytics?period=${value}`,
              }))}
            />
          </DashboardCommandState>
        </DashboardCommandPanel>
      )}
      summary={<StatusStrip items={statusItems} />}
      footer={(
        <p className="text-xs leading-5 text-muted">
          {t("generatedMeta", {
            current: currentRange,
            previous: previousRange,
            generatedAt: dateFormatter.format(new Date(data.generatedAt)),
            timeZone: data.timeZone,
          })}
        </p>
      )}
      density="compact"
    >
      <div className="grid gap-7">
        <DashboardSection title={t("funnelTitle")} description={t("funnelDescription")}>
          <FunnelTable
            data={data}
            labels={{
              stage: t("stageColumn"),
              current: t("currentFacts"),
              currentRate: t("leadConversion"),
              previous: t("previousFacts"),
              unresolved: t("unresolvedColumn"),
              trace: t("trace"),
              unavailable: t("unavailable"),
              stages: stageLabels,
            }}
            numberFormatter={numberFormatter}
            percentFormatter={percentFormatter}
          />
        </DashboardSection>

        <div className="grid min-w-0 gap-7 @6xl/page:grid-cols-2">
          <DashboardSection title={t("channelTitle")} description={t("channelDescription")}>
            <BreakdownTable
              rows={data.channelRows}
              labels={{
                ...commonBreakdownLabels,
                name: t("channelColumn"),
                empty: t("channelEmpty"),
                unknown: t("unknownChannel"),
              }}
              numberFormatter={numberFormatter}
              percentFormatter={percentFormatter}
            />
          </DashboardSection>
          <DashboardSection title={t("batchTitle")} description={t("batchDescription")}>
            <BreakdownTable
              rows={data.batchRows}
              labels={{
                ...commonBreakdownLabels,
                name: t("batchColumn"),
                empty: t("batchEmpty"),
                unknown: t("noBatch"),
              }}
              numberFormatter={numberFormatter}
              percentFormatter={percentFormatter}
            />
          </DashboardSection>
        </div>

        <DashboardSection title={t("supportTitle")} description={t("supportDescription")}>
          <BreakdownTable
            rows={data.supportRows}
            labels={{
              ...commonBreakdownLabels,
              name: t("supportColumn"),
              empty: t("supportEmpty"),
              unknown: t("unassigned"),
            }}
            numberFormatter={numberFormatter}
            percentFormatter={percentFormatter}
          />
          <p className="mt-2 text-xs leading-5 text-muted">{t("supportAttributionNote")}</p>
        </DashboardSection>

        <DashboardSection title={t("activityTitle")} description={t("activityDescription")}>
          {data.activityRows.length === 0 ? <DashboardEmptyCard>{t("activityEmpty")}</DashboardEmptyCard> : (
            <DashboardTableShell>
              <Table className="min-w-[58rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("activityColumn")}</TableHead>
                    <TableHead className="text-right">{t("registrationsColumn")}</TableHead>
                    <TableHead className="text-right">{t("attendedColumn")}</TableHead>
                    <TableHead>{t("attendanceRateColumn")}</TableHead>
                    <TableHead className="text-right">{t("noShowColumn")}</TableHead>
                    <TableHead className="text-right">{t("pendingResultColumn")}</TableHead>
                    <TableHead className="text-right">{t("assessmentColumn")}</TableHead>
                    <TableHead className="text-right">{t("trace")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.activityRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium text-ink">{row.title}</div>
                        <div className="mt-0.5 text-xs text-muted">
                          {dateFormatter.format(new Date(row.scheduledAt))} · {activityKindLabels[row.kind] ?? (row.kind || t("activityKind_unknown"))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{numberFormatter.format(row.registrations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{numberFormatter.format(row.attended)}</TableCell>
                      <TableCell><MetricRate metric={row.attendance} percentFormatter={percentFormatter} unavailableLabel={t("unavailable")} /></TableCell>
                      <TableCell className="text-right tabular-nums">{numberFormatter.format(row.noShows)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", row.pendingResults > 0 && "text-amber-700 dark:text-amber-300")}>{numberFormatter.format(row.pendingResults)}</TableCell>
                      <TableCell className="text-right tabular-nums">{valueOrDash(row.assessment.numerator, numberFormatter)}</TableCell>
                      <TableCell className="text-right">
                        <Link href={row.href} className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">
                          {t("trace")}<ArrowUpRight className="size-3" aria-hidden />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DashboardTableShell>
          )}
        </DashboardSection>

        <DashboardSection title={t("classAttendanceTitle")} description={t("classAttendanceDescription")}>
          <ClassAttendanceTable
            rows={data.classAttendanceRows}
            labels={{
              session: t("sessionColumn"),
              expected: t("expectedColumn"),
              recorded: t("recordedColumn"),
              attended: t("attendedColumn"),
              rate: t("attendanceRateColumn"),
              missing: t("missingColumn"),
              unexpected: t("unexpectedColumn"),
              trace: t("trace"),
              empty: t("classAttendanceEmpty"),
              untitled: t("untitledSession"),
              unavailable: t("unavailable"),
            }}
            locale={locale}
            timeZone={data.timeZone}
            numberFormatter={numberFormatter}
            percentFormatter={percentFormatter}
          />
        </DashboardSection>

        <div className="grid min-w-0 gap-7 @5xl/page:grid-cols-2">
          <DashboardSection title={t("backlogTitle")} description={t("backlogDescription")}>
            <DashboardTableShell>
              <Table>
                <TableHeader><TableRow><TableHead>{t("backlogColumn")}</TableHead><TableHead className="text-right">{t("countColumn")}</TableHead><TableHead className="text-right">{t("trace")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {([
                    ["unassignedLeads", data.backlog.unassignedLeads, "/dashboard/leads?scope=unassigned"],
                    ["overdueReminders", data.backlog.overdueReminders, "/dashboard/leads?scope=all"],
                    ["dueSoonReminders", data.backlog.dueSoonReminders, "/dashboard/leads?scope=all"],
                    ["arrivedWithoutAssessment", data.backlog.arrivedWithoutAssessment, "/dashboard/assessments"],
                  ] as const).map(([key, metric, href]) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium text-ink">{t(`backlog_${key}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">{valueOrDash(metric.numerator, numberFormatter)}</TableCell>
                      <TableCell className="text-right"><Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline">{t("trace")}<ArrowUpRight className="size-3" aria-hidden /></Link></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DashboardTableShell>
          </DashboardSection>

          <DashboardSection title={t("dependencyTitle")} description={t("dependencyDescription")}>
            <DashboardTableShell>
              <Table>
                <TableHeader><TableRow><TableHead>{t("capabilityColumn")}</TableHead><TableHead>{t("stateColumn")}</TableHead><TableHead>{t("dependencyColumn")}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.dependencies.map((dependency) => (
                    <TableRow key={dependency.key}>
                      <TableCell className="font-medium text-ink">{t(`dependency_${dependency.key}`)}</TableCell>
                      <TableCell><Badge variant="outline">{t("waitingForFacts")}</Badge></TableCell>
                      <TableCell className="text-xs text-muted">{t("phaseDependency", { phase: dependency.phase })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DashboardTableShell>
          </DashboardSection>
        </div>

        <DashboardSection title={t("automationTitle")} description={t("automationDescription")}>
          <DashboardTableShell>
            <Table className="min-w-[48rem]">
              <TableHeader><TableRow><TableHead>{t("capabilityColumn")}</TableHead><TableHead>{t("stateColumn")}</TableHead><TableHead>{t("evidenceColumn")}</TableHead><TableHead>{t("boundaryColumn")}</TableHead></TableRow></TableHeader>
              <TableBody>
                {([
                  { key: "manualReminder", icon: ShieldCheck, state: "available", evidence: t("automation_manualReminderEvidence"), boundary: t("automation_manualReminderBoundary") },
                  { key: "automaticReminder", icon: CircleAlert, state: "defaultOff", evidence: t("automation_automaticReminderEvidence"), boundary: t("automation_automaticReminderBoundary") },
                  { key: "automaticAssignment", icon: GitBranch, state: "defaultOff", evidence: t("automation_automaticAssignmentEvidence"), boundary: t("automation_automaticAssignmentBoundary") },
                  { key: "apiSync", icon: Database, state: "dependency", evidence: t("automation_apiSyncEvidence"), boundary: t("automation_apiSyncBoundary") },
                ] as const).map((item) => {
                  const Icon = item.icon;
                  return (
                    <TableRow key={item.key}>
                      <TableCell><span className="inline-flex items-center gap-2 font-medium text-ink"><Icon className="size-4 text-muted" aria-hidden />{t(`automation_${item.key}`)}</span></TableCell>
                      <TableCell><Badge variant={item.state === "available" ? "secondary" : "outline"}>{t(`automationState_${item.state}`)}</Badge></TableCell>
                      <TableCell className="text-xs text-muted">{item.evidence}</TableCell>
                      <TableCell className="max-w-md text-xs leading-5 text-muted">{item.boundary}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DashboardTableShell>
        </DashboardSection>

        {sourceIssueCount > 0 ? (
          <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 px-4 py-3 text-xs leading-5 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-200">
            <div className="font-medium">{t("sourceIssueTitle")}</div>
            {data.unavailableSources.length > 0 ? <p>{t("unavailableSources", { sources: sourceList(data.unavailableSources, (key) => t(`source_${key}`)) })}</p> : null}
            {data.truncatedSources.length > 0 ? <p>{t("truncatedSources", { sources: sourceList(data.truncatedSources, (key) => t(`source_${key}`)), limit: 10000 })}</p> : null}
          </div>
        ) : null}
      </div>
    </DashboardPage>
  );
}
