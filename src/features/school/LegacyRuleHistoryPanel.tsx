import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardTableShell } from "./dashboard-page";
import type { LegacyOrganizationRuleVersionV2 } from "./legacy-rule-history";

export async function LegacyRuleHistoryPanel({
  rows,
  locale,
  timeZone,
}: {
  rows: LegacyOrganizationRuleVersionV2[];
  locale: string;
  timeZone: string;
}) {
  const [t, legacyT] = await Promise.all([
    getTranslations("school.capabilityRelease"),
    getTranslations("school.organization"),
  ]);
  const formatter = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" });
  return (
    <DashboardTableShell>
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-base font-medium text-ink">{t("legacyRulesTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("legacyRulesIntro")}</p>
      </div>
      {rows.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{t("legacyRulesEmpty")}</p> : (
        <Table className="min-w-[58rem]">
            <TableHeader><TableRow><TableHead>{t("legacyDomain")}</TableHead><TableHead>{t("version")}</TableHead><TableHead>{t("effectiveWindow")}</TableHead><TableHead>{t("legacyValue")}</TableHead><TableHead>{t("reason")}</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="align-top"><div className="font-medium">{legacyT(`rule_${row.domain}`)}</div>{row.legacyCampusName ? <Badge variant="outline" className="mt-2">{t("legacyCampusScope", { campus: row.legacyCampusName })}</Badge> : <p className="mt-1 text-xs text-muted">{t("organizationWide")}</p>}</TableCell>
                <TableCell className="align-top font-mono text-xs">v{row.version}</TableCell>
                <TableCell className="whitespace-nowrap align-top text-xs text-muted">{formatter.format(new Date(row.effectiveFrom))}<br />{row.effectiveUntil ? `→ ${formatter.format(new Date(row.effectiveUntil))}` : `→ ${t("legacyOpenInterval")}`}</TableCell>
                <TableCell className="align-top"><pre className="max-h-40 max-w-xl overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper/60 p-2 text-xs">{JSON.stringify(row.value, null, 2)}</pre></TableCell>
                <TableCell className="max-w-xs align-top text-sm"><p>{row.reason}</p><p className="mt-1 text-xs text-muted">{row.createdBy || t("systemActor")}</p></TableCell>
              </TableRow>
            ))}</TableBody>
        </Table>
      )}
    </DashboardTableShell>
  );
}
