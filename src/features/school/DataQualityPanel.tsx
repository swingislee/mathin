"use client";

import { DatabaseZap, LoaderCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { runDataQualityScanAction } from "./actions/data-quality";
import type { DataQualityFinding, DataQualityRun, DataQualitySeverity } from "./data-quality";
import { DashboardCard, DashboardEmptyCard } from "./dashboard-page";

const severities: DataQualitySeverity[] = ["critical", "error", "warning", "info"];

function badgeVariant(severity: DataQualitySeverity): "danger" | "outline" | "secondary" {
  if (severity === "critical" || severity === "error") return "danger";
  return severity === "warning" ? "outline" : "secondary";
}

function compactEvidence(finding: DataQualityFinding) {
  return JSON.stringify(finding.evidence);
}

export function DataQualityPanel({ initialRun, canRun }: { initialRun: DataQualityRun | null; canRun: boolean }) {
  const t = useTranslations("school.dataQuality");
  const locale = useLocale();
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" });
  const scan = useAction(runDataQualityScanAction, {
    successMessage: t("scanSuccess"),
    errorMessage: { default: t("scanFailed"), FORBIDDEN: t("forbidden") },
    onSuccess: (value) => {
      setRun(value);
      router.refresh();
    },
  });

  return (
    <DashboardCard
      title={t("title")}
      description={t("description")}
      actions={canRun ? (
        <Button type="button" size="sm" disabled={scan.pending} onClick={() => scan.run()}>
          {scan.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <DatabaseZap size={15} />}
          {scan.pending ? t("scanning") : t("runScan")}
        </Button>
      ) : undefined}
    >
      {!run ? (
        <DashboardEmptyCard className="border-0 bg-moon/10">{t("empty")}</DashboardEmptyCard>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 @xl/page:grid-cols-2 @4xl/page:grid-cols-3 @6xl/page:grid-cols-5">
            <div className="rounded-xl border border-line bg-paper/40 p-3">
              <p className="text-xs text-muted">{t("total")}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{run.total}</p>
            </div>
            {severities.map((severity) => (
              <div key={severity} className="rounded-xl border border-line bg-paper/40 p-3">
                <p className="text-xs text-muted">{t(`severity_${severity}`)}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{run.counts[severity]}</p>
              </div>
            ))}
          </div>

          <dl className="grid gap-x-6 gap-y-2 text-xs text-muted md:grid-cols-2">
            <div><dt className="inline font-medium text-ink">{t("snapshot")}: </dt><dd className="inline">{dateFormatter.format(new Date(run.snapshotAt))}</dd></div>
            <div><dt className="inline font-medium text-ink">{t("ruleSet")}: </dt><dd className="inline font-mono">{run.ruleSetVersion}</dd></div>
            <div className="min-w-0"><dt className="inline font-medium text-ink">{t("rulesHash")}: </dt><dd className="inline break-all font-mono">{run.rulesHash}</dd></div>
            <div className="min-w-0"><dt className="inline font-medium text-ink">{t("findingsHash")}: </dt><dd className="inline break-all font-mono">{run.findingsHash}</dd></div>
          </dl>

          {run.findings.length === 0 ? (
            <p role="status" className="rounded-xl border border-line bg-moon/10 px-4 py-6 text-center text-sm text-muted">{t("clean")}</p>
          ) : (
            <div>
              <Table className="min-w-[62rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("severity")}</TableHead>
                    <TableHead>{t("rule")}</TableHead>
                    <TableHead>{t("object")}</TableHead>
                    <TableHead>{t("evidence")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.findings.map((finding) => (
                    <TableRow key={finding.id}>
                      <TableCell><Badge variant={badgeVariant(finding.severity)}>{t(`severity_${finding.severity}`)}</Badge></TableCell>
                      <TableCell>
                        <p className="font-medium text-ink">{t(`rule_${finding.ruleKey}`)}</p>
                        <p className="mt-1 font-mono text-xs text-muted">v{finding.ruleVersion} · {finding.ruleKey}</p>
                      </TableCell>
                      <TableCell>
                        <p>{finding.objectType}</p>
                        <p className="mt-1 max-w-64 break-all font-mono text-xs text-muted">{finding.objectId ?? "—"}</p>
                      </TableCell>
                      <TableCell className="max-w-xl break-all font-mono text-xs text-muted">{compactEvidence(finding)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {run.truncated ? <p className="mt-3 text-xs text-muted">{t("truncated")}</p> : null}
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}