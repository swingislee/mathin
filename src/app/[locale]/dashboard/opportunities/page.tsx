import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listSalesOpportunities } from "@/features/school/activities";
import {
  DashboardCommandPanel,
  DashboardCommandState,
  DashboardCommandTabs,
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
} from "@/features/school/dashboard-page";
import { getOrganizationTimezoneV2 } from "@/features/school/organization-locations";
import { Link } from "@/i18n/navigation";
import { getMyPerms, requirePerm } from "@/lib/auth";

type StageFilter = "open" | "won" | "lost" | "all";

function parseStage(value: string | string[] | undefined): StageFilter {
  return value === "won" || value === "lost" || value === "all" ? value : "open";
}

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(locale);
  const user = await requirePerm(locale, "followup.view");
  const [t, permissions, allRows, timeZone] = await Promise.all([
    getTranslations("school.activities"),
    getMyPerms(user.id),
    listSalesOpportunities(),
    getOrganizationTimezoneV2(),
  ]);
  const canScopeAll = permissions.has("student.view.all");
  const scope = canScopeAll && query.scope === "all" ? "all" : "mine";
  const stage = parseStage(query.stage);
  const scopedRows = allRows.filter((row) => scope === "all" || row.ownerId === user.id);
  const rows = scopedRows.filter((row) => {
    if (stage === "all") return true;
    if (stage === "open") return row.stage !== "won" && row.stage !== "lost";
    return row.stage === stage;
  });
  const href = (next: { scope?: "mine" | "all"; stage?: StageFilter }) => {
    const params = new URLSearchParams();
    const nextScope = next.scope ?? scope;
    const nextStage = next.stage ?? stage;
    if (nextScope === "all") params.set("scope", "all");
    if (nextStage !== "open") params.set("stage", nextStage);
    const value = params.toString();
    return `/dashboard/opportunities${value ? `?${value}` : ""}`;
  };
  const dateTime = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" });

  return <DashboardPage
    title={t("opportunityQueueTitle")}
    description={t("opportunityQueueHint")}
    commandPanel={<DashboardCommandPanel>
      {canScopeAll ? <DashboardCommandState>
        <DashboardCommandTabs
          ariaLabel={t("opportunityScopeLabel")}
          activeValue={scope}
          items={[
            { value: "mine", label: t("opportunityScopeMine"), href: href({ scope: "mine" }) },
            { value: "all", label: t("opportunityScopeAll"), href: href({ scope: "all" }) },
          ]}
        />
      </DashboardCommandState> : null}
      <DashboardCommandState>
        <DashboardCommandTabs
          ariaLabel={t("opportunityStageFilter")}
          activeValue={stage}
          items={(["open", "won", "lost", "all"] as const).map((value) => ({
            value,
            label: t(`opportunityFilter_${value}`),
            href: href({ stage: value }),
          }))}
        />
      </DashboardCommandState>
    </DashboardCommandPanel>}
    summary={<StatusStrip items={[
      { label: t("opportunityFilter_open"), value: scopedRows.filter((row) => row.stage !== "won" && row.stage !== "lost").length },
      { label: t("stage_won"), value: scopedRows.filter((row) => row.stage === "won").length },
      { label: t("stage_lost"), value: scopedRows.filter((row) => row.stage === "lost").length },
    ]} />}
  >
    <DashboardSection title={t("opportunityQueueList")} description={t("opportunityQueueCount", { count: rows.length })}>
      <DashboardTableShell>
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t("student")}</TableHead>
            <TableHead>{t("teacherRecommendation")}</TableHead>
            <TableHead>{t("sourceActivity")}</TableHead>
            <TableHead>{t("opportunityOwner")}</TableHead>
            <TableHead>{t("nextAction")}</TableHead>
            <TableHead>{t("opportunityStage")}</TableHead>
            <TableHead className="text-right">{t("actions")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => <TableRow key={row.id}>
              <TableCell><Link href={`/dashboard/students/${row.studentId}`} className="font-medium text-ink hover:underline">{row.studentName}</Link>{row.studentGrade ? <p className="mt-0.5 text-xs text-muted">{t("gradeValue", { grade: row.studentGrade })}</p> : null}</TableCell>
              <TableCell className="max-w-72 whitespace-normal text-sm text-muted">{row.teacherRecommendation || "—"}</TableCell>
              <TableCell><Link href={`/dashboard/activities/${row.activityId}?registration=${row.registrationId}`} className="font-medium text-ink hover:underline">{row.activityTitle}</Link><p className="mt-0.5 text-xs text-muted">{dateTime.format(new Date(row.activityScheduledAt))}</p></TableCell>
              <TableCell>{row.ownerName}</TableCell>
              <TableCell className="max-w-64 whitespace-normal"><p className="text-sm text-ink">{row.nextAction || "—"}</p><p className="mt-0.5 text-xs text-muted">{row.nextActionAt ? dateTime.format(new Date(row.nextActionAt)) : "—"}</p></TableCell>
              <TableCell><Badge variant={row.stage === "won" ? "secondary" : "outline"}>{t(`stage_${row.stage}`)}</Badge></TableCell>
              <TableCell className="text-right"><Link href={`/dashboard/activities/${row.activityId}?registration=${row.registrationId}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>{t("openActivity")}</Link></TableCell>
            </TableRow>)}
            {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted">{t("opportunityQueueEmpty")}</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </DashboardSection>
  </DashboardPage>;
}
