import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
  type StatusStripItem,
} from "@/features/school/dashboard-page";
import { SCHOOL_OPS_REVIEW_PERMS } from "@/features/school/dashboard-routes";
import { getSchoolOpsArchitectureSnapshot } from "@/features/school/school-ops-architecture";
import { Link } from "@/i18n/navigation";
import { requireAnyPerm } from "@/lib/auth";

const FLOW = [
  { key: "external", href: null },
  { key: "inbox", href: "/dashboard/students/import" },
  { key: "lead", href: "/dashboard/students" },
  { key: "nextAction", href: "/dashboard/followups" },
  { key: "activity", href: "/dashboard/activities" },
  { key: "assessment", href: null },
  { key: "opportunity", href: null },
  { key: "enrollment", href: null },
  { key: "classMembership", href: "/dashboard/classes" },
  { key: "session", href: "/dashboard/schedule" },
  { key: "attendance", href: "/dashboard/classes" },
] as const;

const DOMAIN_ROWS = [
  { key: "identity", decision: "refactor" },
  { key: "import", decision: "extend" },
  { key: "work", decision: "refactor" },
  { key: "activity", decision: "extend" },
  { key: "sales", decision: "new" },
  { key: "membership", decision: "reframe" },
  { key: "delivery", decision: "reuse" },
  { key: "time", decision: "reuse" },
] as const;

const MILESTONES = ["phase0", "phase1", "phase2", "phase3", "phase4", "phase5", "phase6"] as const;
const OPEN_QUESTIONS = ["externalColumns", "familyInputs", "assessmentFields", "saleConfirmation"] as const;

const DECISION_VARIANT = {
  reuse: "default",
  extend: "outline",
  refactor: "secondary",
  reframe: "secondary",
  new: "outline",
} as const;

export default async function SchoolOpsArchitecturePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("school.schoolOps");

  return (
    <DashboardPage title={t("title")} description={t("description")}>
      <Suspense fallback={<SchoolOpsArchitectureSkeleton />}>
        <SchoolOpsArchitectureContent locale={locale} />
      </Suspense>
    </DashboardPage>
  );
}

async function SchoolOpsArchitectureContent({ locale }: { locale: string }) {
  await requireAnyPerm(locale, SCHOOL_OPS_REVIEW_PERMS);
  const [t, snapshot] = await Promise.all([
    getTranslations("school.schoolOps"),
    getSchoolOpsArchitectureSnapshot(),
  ]);
  const snapshotItems: StatusStripItem[] = [
    { label: t("metrics.importBatches"), value: metricValue(snapshot.importBatches, t("unavailable")) },
    { label: t("metrics.leads"), value: metricValue(snapshot.leadStudents, t("unavailable")) },
    { label: t("metrics.dueFollowUps"), value: metricValue(snapshot.dueFollowUps, t("unavailable")) },
    { label: t("metrics.activities"), value: metricValue(snapshot.activities, t("unavailable")) },
    { label: t("metrics.classMemberships"), value: metricValue(snapshot.activeClassMemberships, t("unavailable")) },
    { label: t("metrics.sessions"), value: metricValue(snapshot.sessions, t("unavailable")) },
    { label: t("metrics.attendance"), value: metricValue(snapshot.attendanceRecords, t("unavailable")) },
  ];

  return (
    <div className="space-y-10">
      <DashboardSection title={t("snapshotTitle")} description={t("snapshotDescription")}>
        <StatusStrip items={snapshotItems} />
      </DashboardSection>

      <DashboardSection title={t("flowTitle")} description={t("flowDescription")}>
        <figure aria-label={t("flowAriaLabel")}>
          <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-sm">
            {FLOW.map((stage, index) => (
              <li key={stage.key} className="flex min-w-0 items-center gap-2">
                {index > 0 ? <span aria-hidden className="text-line">→</span> : null}
                {stage.href ? (
                  <Link href={stage.href} className="rounded-lg px-1.5 py-1 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                    {t(`flow.${stage.key}`)}
                  </Link>
                ) : (
                  <span className="rounded-lg px-1.5 py-1 text-muted">{t(`flow.${stage.key}`)}</span>
                )}
              </li>
            ))}
          </ol>
          <figcaption className="mt-3 text-xs leading-5 text-muted">{t("flowCaption")}</figcaption>
        </figure>
      </DashboardSection>

      <DashboardSection title={t("mappingTitle")} description={t("mappingDescription")}>
        <DashboardTableShell>
          <Table className="min-w-[64rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.domain")}</TableHead>
                <TableHead>{t("columns.target")}</TableHead>
                <TableHead>{t("columns.current")}</TableHead>
                <TableHead>{t("columns.decision")}</TableHead>
                <TableHead>{t("columns.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DOMAIN_ROWS.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium text-ink">{t(`mapping.${row.key}.domain`)}</TableCell>
                  <TableCell className="font-mono text-xs">{t(`mapping.${row.key}.target`)}</TableCell>
                  <TableCell className="max-w-72 text-sm text-muted">{t(`mapping.${row.key}.current`)}</TableCell>
                  <TableCell>
                    <Badge variant={DECISION_VARIANT[row.decision]}>{t(`decisions.${row.decision}`)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-96 text-sm leading-6">{t(`mapping.${row.key}.reason`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DashboardTableShell>
      </DashboardSection>

      <DashboardSection title={t("boundaryTitle")} description={t("boundaryDescription")}>
        <div className="grid gap-6 md:grid-cols-3 md:gap-0">
          {(["commercial", "handoff", "teaching"] as const).map((key, index) => (
            <section key={key} className={index === 0 ? "min-w-0 md:pr-6" : "min-w-0 md:border-l md:border-line md:px-6"}>
              <h3 className="text-sm font-medium text-ink">{t(`boundaries.${key}.title`)}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{t(`boundaries.${key}.description`)}</p>
            </section>
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title={t("milestoneTitle")} description={t("milestoneDescription")}>
        <ol className="space-y-0">
          {MILESTONES.map((phase, index) => (
            <li key={phase} className="grid gap-2 border-t border-line/60 py-4 first:border-t-0 first:pt-0 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{t(`milestones.${phase}.label`)}</span>
                {index === 0 ? <Badge>{t("current")}</Badge> : <Badge variant="outline">{t("gated")}</Badge>}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-ink">{t(`milestones.${phase}.title`)}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{t(`milestones.${phase}.description`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </DashboardSection>

      <DashboardSection title={t("openQuestionsTitle")} description={t("openQuestionsDescription")}>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
          {OPEN_QUESTIONS.map((key) => <li key={key}>{t(`openQuestions.${key}`)}</li>)}
        </ul>
      </DashboardSection>
    </div>
  );
}

function metricValue(value: number | null, unavailable: string) {
  return value === null ? unavailable : value.toLocaleString();
}

function SchoolOpsArchitectureSkeleton() {
  return (
    <div aria-hidden className="space-y-8">
      <div className="h-14 animate-pulse rounded-xl bg-line/25" />
      <div className="h-28 animate-pulse rounded-xl bg-line/20" />
      <div className="h-80 animate-pulse rounded-xl bg-line/20" />
    </div>
  );
}
