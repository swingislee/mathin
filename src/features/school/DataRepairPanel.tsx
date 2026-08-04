"use client";

import { ClipboardCheck, LoaderCircle, Play, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  executeDataRepairPlanAction,
  previewOrderStatusRepairAction,
  rollbackDataRepairPlanAction,
} from "./actions/data-repair";
import type { DataQualityFinding, DataQualityRun } from "./data-quality";
import type { DataRepairCapability, DataRepairPlan, DataRepairPlanStatus } from "./data-repair";
import { DashboardCard, DashboardEmptyCard } from "./dashboard-page";

function statusVariant(status: DataRepairPlanStatus): "outline" | "default" | "secondary" {
  if (status === "previewed") return "outline";
  return status === "executed" ? "default" : "secondary";
}

type OrderStatusFinding = DataQualityFinding & { objectId: string };

function isOrderStatusCandidate(finding: DataQualityFinding): finding is OrderStatusFinding {
  if (finding.ruleKey !== "order_amount_unbalanced" || !finding.objectId) return false;
  const evidence = finding.evidence;
  return String(evidence.amountDue) === String(evidence.expectedDue)
    && evidence.actualStatus !== "void"
    && evidence.actualStatus !== evidence.expectedStatus;
}

export function DataRepairPanel({
  latestRun,
  initialCapabilities,
  initialPlans,
  canManage,
  financeEnabled,
}: {
  latestRun: DataQualityRun | null;
  initialCapabilities: DataRepairCapability[];
  initialPlans: DataRepairPlan[];
  canManage: boolean;
  /** R1-8 关闭门：为 false 时 finance 域的修复能力只保留审计视图，不提供预览/执行/回滚入口。 */
  financeEnabled: boolean;
}) {
  const t = useTranslations("school.dataRepair");
  const locale = useLocale();
  const router = useRouter();
  const [localPlans, setLocalPlans] = useState<DataRepairPlan[]>([]);
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const financeRepairKeys = new Set(
    initialCapabilities.filter((capability) => capability.domain === "finance").map((capability) => capability.repairKey),
  );
  // 订单状态重算是 finance 域能力：关闭期间不生成候选，也不显示执行/回滚入口。
  const candidates = financeEnabled ? (latestRun?.findings.filter(isOrderStatusCandidate) ?? []) : [];
  const canActOn = (plan: DataRepairPlan) => canManage && (financeEnabled || !financeRepairKeys.has(plan.repairKey));

  const plans = [...localPlans, ...initialPlans]
    .filter((plan, index, all) => all.findIndex((candidate) => candidate.id === plan.id) === index)
    .slice(0, 25);

  const replacePlan = (next: DataRepairPlan) => {
    setLocalPlans((current) => [next, ...current.filter((item) => item.id !== next.id)].slice(0, 25));
    router.refresh();
  };
  const preview = useAction(previewOrderStatusRepairAction, {
    successMessage: t("previewSuccess"),
    errorMessage: {
      default: t("previewFailed"),
      FINANCE_RELEASE_CLOSED: t("financeClosedError"),
      REPAIR_NOT_APPLICABLE: t("notApplicable"),
      QUALITY_FINDING_NOT_FOUND: t("findingExpired"),
    },
    onSuccess: replacePlan,
  });
  const execute = useAction(executeDataRepairPlanAction, {
    successMessage: t("executeSuccess"),
    errorMessage: {
      default: t("executeFailed"),
      FINANCE_RELEASE_CLOSED: t("financeClosedError"),
      REPAIR_TARGET_CHANGED: t("targetChanged"),
      REPAIR_PLAN_EXPIRED: t("planExpired"),
      REPAIR_PLAN_STATE_CONFLICT: t("stateConflict"),
    },
    onSuccess: replacePlan,
  });
  const rollback = useAction(rollbackDataRepairPlanAction, {
    successMessage: t("rollbackSuccess"),
    errorMessage: {
      default: t("rollbackFailed"),
      FINANCE_RELEASE_CLOSED: t("financeClosedError"),
      REPAIR_TARGET_CHANGED: t("rollbackTargetChanged"),
      REPAIR_PLAN_STATE_CONFLICT: t("stateConflict"),
    },
    onSuccess: replacePlan,
  });

  return (
    <DashboardCard title={t("title")} description={t("description")}>
      <div className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {initialCapabilities.map((capability) => (
            <div key={`${capability.repairKey}:${capability.version}`} className="rounded-xl border border-line bg-paper/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{t(`capability_${capability.repairKey}`)}</p>
                <Badge variant={capability.planManaged ? "default" : "secondary"}>v{capability.version}</Badge>
              </div>
              <p className="mt-2 text-xs text-muted">{t(`recovery_${capability.recoveryClass}`)}</p>
              <p className="mt-2 break-all font-mono text-[11px] text-muted">{capability.entrypoint}</p>
            </div>
          ))}
        </div>

        {canManage ? (
          <section className="space-y-3" aria-labelledby="repair-candidates-title">
            <div>
              <h3 id="repair-candidates-title" className="flex items-center gap-2 text-sm font-semibold text-ink"><Wrench size={16} />{t("candidatesTitle")}</h3>
              <p className="mt-1 text-xs text-muted">{t("candidatesHint")}</p>
            </div>
            {!financeEnabled ? (
              <DashboardEmptyCard className="border-0 bg-moon/10">{t("financeClosed")}</DashboardEmptyCard>
            ) : candidates.length === 0 ? (
              <DashboardEmptyCard className="border-0 bg-moon/10">{t("candidatesEmpty")}</DashboardEmptyCard>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line px-4">
                {candidates.map((finding) => (
                  <li key={finding.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-ink">{t("orderCandidate", { id: finding.objectId })}</p>
                      <p className="mt-1 text-xs text-muted">
                        {t("statusChange", { before: String(finding.evidence.actualStatus), after: String(finding.evidence.expectedStatus) })}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" disabled={preview.pending} onClick={() => preview.run(finding.id)}>
                      {preview.pending ? <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" /> : <ClipboardCheck size={15} />}
                      {t("previewAction")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <section className="space-y-3" aria-labelledby="repair-plans-title">
          <div>
            <h3 id="repair-plans-title" className="flex items-center gap-2 text-sm font-semibold text-ink"><ShieldCheck size={16} />{t("plansTitle")}</h3>
            <p className="mt-1 text-xs text-muted">{t("plansHint")}</p>
          </div>
          {plans.length === 0 ? (
            <DashboardEmptyCard className="border-0 bg-moon/10">{t("plansEmpty")}</DashboardEmptyCard>
          ) : (
            <ul className="space-y-3">
              {plans.map((plan) => (
                <li key={plan.id} className="rounded-xl border border-line bg-paper/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{t(`capability_${plan.repairKey}`)}</p>
                        <Badge variant={statusVariant(plan.status)}>{t(`status_${plan.status}`)}</Badge>
                        <span className="text-xs text-muted">{t("impact", { count: plan.impactCount })}</span>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-muted">{plan.targetObjectId}</p>
                      <p className="mt-2 text-xs text-muted">
                        {t("statusChange", { before: plan.recoverySnapshot.status, after: plan.expectedAfterSnapshot.status })}
                        {" · "}{dateFormatter.format(new Date(plan.createdAt))}
                      </p>
                    </div>
                    {canActOn(plan) && plan.status === "previewed" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button type="button" size="sm" disabled={execute.pending}><Play size={15} />{t("executeAction")}</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("executeTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("executeDescription", { before: plan.recoverySnapshot.status, after: plan.expectedAfterSnapshot.status })}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => execute.run(plan.id)}>{t("executeConfirm")}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                    {canActOn(plan) && plan.status === "executed" ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button type="button" size="sm" variant="secondary" disabled={rollback.pending}><RotateCcw size={15} />{t("rollbackAction")}</Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("rollbackTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("rollbackDescription", { before: plan.expectedAfterSnapshot.status, after: plan.recoverySnapshot.status })}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => rollback.run(plan.id)}>{t("rollbackConfirm")}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                  <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-[11px] text-muted md:grid-cols-2">
                    <div className="min-w-0"><dt className="font-medium text-ink">{t("targetHash")}</dt><dd className="break-all font-mono">{plan.targetHash}</dd></div>
                    <div className="min-w-0"><dt className="font-medium text-ink">{t("expectedHash")}</dt><dd className="break-all font-mono">{plan.expectedAfterHash}</dd></div>
                    <div><dt className="font-medium text-ink">{t("expiresAt")}</dt><dd>{dateFormatter.format(new Date(plan.expiresAt))}</dd></div>
                    <div><dt className="font-medium text-ink">{t("eventCount")}</dt><dd>{plan.events.length}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </DashboardCard>
  );
}
