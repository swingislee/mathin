"use client";

import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import {
  rollbackCapabilityReleaseAction,
  setCapabilityReleaseAction,
} from "./actions/capability-release";
import type { CapabilityReleaseV2 } from "./capability-release-contract";
import { DashboardTableShell } from "./dashboard-page";
import type { OrganizationFeatureKey } from "./organization-settings-contract";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

function messageKey(flagKey: OrganizationFeatureKey) {
  return flagKey.replaceAll(".", "_");
}

export function CapabilityReleasePanel({
  capabilities,
  canManage,
  timeZone,
}: {
  capabilities: CapabilityReleaseV2[];
  canManage: boolean;
  timeZone: string;
}) {
  const t = useTranslations("school.capabilityRelease");
  const legacyT = useTranslations("school.organization");
  const locale = useLocale();
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState<OrganizationFeatureKey>(capabilities[0]?.flagKey ?? "finance.enabled");
  const selected = capabilities.find((item) => item.flagKey === selectedKey) ?? capabilities[0] ?? null;
  const [enabled, setEnabled] = useState(selected?.enabled ?? false);
  const [effectiveAt, setEffectiveAt] = useState(() => zonedDateTimeInputValue(new Date(), timeZone));
  const [reason, setReason] = useState("");
  const errors = {
    INVALID_FEATURE_FLAG: t("invalidVersion"),
    FINANCE_RELEASE_CLOSED: t("financeLocked"),
    FORBIDDEN: t("forbidden"),
    default: t("actionFailed"),
  };
  const releaseRun = useAction(setCapabilityReleaseAction, {
    successMessage: t("versionCreated"),
    errorMessage: errors,
    onSuccess: () => { setReason(""); router.refresh(); },
  });
  const rollbackRun = useAction(rollbackCapabilityReleaseAction, {
    successMessage: t("rollbackCreated"),
    errorMessage: errors,
    onSuccess: () => router.refresh(),
  });
  const pending = releaseRun.pending || rollbackRun.pending;
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const chooseCapability = (flagKey: OrganizationFeatureKey) => {
    const next = capabilities.find((item) => item.flagKey === flagKey);
    setSelectedKey(flagKey);
    setEnabled(next?.enabled ?? false);
    setReason("");
  };
  const effectiveInstant = dateTimeInputToInstant(effectiveAt, timeZone);
  const createVersion = () => {
    if (!selected || !effectiveInstant || !reason.trim()) return;
    releaseRun.run({
      flagKey: selected.flagKey,
      enabled,
      effectiveAt: effectiveInstant.toISOString(),
      reason: reason.trim(),
    });
  };

  if (!selected) return <p className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">{t("empty")}</p>;

  return (
    <div className="grid gap-5">
      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="grid gap-4 @3xl/page:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] @3xl/page:items-end">
          <Label className="grid gap-1 text-xs font-normal text-muted">
            {t("capability")}
            <Select value={selected.flagKey} onValueChange={(value) => chooseCapability(value as OrganizationFeatureKey)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{capabilities.map((item) => (
                <SelectItem key={item.flagKey} value={item.flagKey}>{legacyT(`flag_${messageKey(item.flagKey)}`)}</SelectItem>
              ))}</SelectContent>
            </Select>
          </Label>
          <div className="rounded-xl bg-moon/25 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-ink">{legacyT(`flag_${messageKey(selected.flagKey)}`)}</p>
              <Badge variant={selected.enabled && !selected.financeReleaseLocked ? "default" : "outline"}>
                {selected.enabled && !selected.financeReleaseLocked ? t("on") : t("off")}
              </Badge>
              {selected.financeReleaseLocked ? <Badge variant="danger">{t("releaseLocked")}</Badge> : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              {selected.financeReleaseLocked ? legacyT("financeReleaseClosedHelp") : legacyT(`flagHelp_${messageKey(selected.flagKey)}`)}
            </p>
          </div>
        </div>
      </section>

      {canManage && !selected.financeReleaseLocked ? (
        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="text-base font-medium text-ink">{t("editorTitle")}</h2>
          <p className="mt-1 text-sm text-muted">{t("editorIntro")}</p>
          <div className="mt-5 grid gap-4 @3xl/page:grid-cols-2">
            <div className="flex items-start gap-3 rounded-xl border border-line p-4 @3xl/page:col-span-2">
              <Checkbox id="capability-enabled" checked={enabled} onCheckedChange={(value) => setEnabled(value === true)} />
              <div><Label htmlFor="capability-enabled" className="cursor-pointer">{enabled ? t("enableVersion") : t("disableVersion")}</Label><p className="mt-1 text-xs text-muted">{t("failClosedHint")}</p></div>
            </div>
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {t("effectiveAt")}
              <DateTimePicker mode="datetime" value={effectiveAt} onValueChange={setEffectiveAt} />
            </Label>
            <Label className="grid gap-1 text-xs font-normal text-muted">
              {t("reason")}
              <Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder={t("reasonPlaceholder")} />
            </Label>
          </div>
          <Button type="button" className="mt-5" disabled={pending || !effectiveInstant || !reason.trim()} onClick={createVersion}>
            {releaseRun.pending && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}{t("createVersion")}
          </Button>
        </section>
      ) : (
        <section className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">
          <p className="flex items-center gap-2 font-medium text-ink"><AlertTriangle className="size-4" />{selected.financeReleaseLocked ? t("financeLocked") : t("historyOnly")}</p>
          <p className="mt-1 text-xs leading-5">{selected.financeReleaseLocked ? legacyT("financeReleaseClosedHelp") : t("historyOnlyHint")}</p>
        </section>
      )}

      <DashboardTableShell>
        <div className="border-b border-line px-5 py-4"><h2 className="text-base font-medium text-ink">{t("historyTitle")}</h2><p className="mt-1 text-sm text-muted">{t("historyIntro")}</p></div>
        {selected.versions.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{t("noHistory")}</p> : (
          <Table className="min-w-[48rem]">
            <TableHeader><TableRow><TableHead>{t("version")}</TableHead><TableHead>{t("state")}</TableHead><TableHead>{t("effectiveWindow")}</TableHead><TableHead>{t("reason")}</TableHead><TableHead>{t("actor")}</TableHead><TableHead className="text-right">{t("action")}</TableHead></TableRow></TableHeader>
            <TableBody>{selected.versions.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">v{row.version}</TableCell>
                <TableCell><div className="flex items-center gap-2"><Badge variant={row.enabled ? "default" : "outline"}>{row.enabled ? t("on") : t("off")}</Badge>{row.isEffective ? <Badge variant="secondary">{t("effectiveNow")}</Badge> : null}</div></TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted">{formatter.format(new Date(row.effectiveFrom))}<br />{row.effectiveUntil ? `→ ${formatter.format(new Date(row.effectiveUntil))}` : `→ ${t("openEnded")}`}</TableCell>
                <TableCell className="max-w-sm text-sm">{row.reason}</TableCell>
                <TableCell className="text-xs text-muted">{row.createdBy || t("systemActor")}</TableCell>
                <TableCell className="text-right">{canManage && !selected.financeReleaseLocked && !row.isEffective ? (
                  <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => rollbackRun.run(row.id, new Date().toISOString(), t("rollbackReason", { version: row.version }))}>
                    {rollbackRun.pending && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />}<RotateCcw className="size-3.5" />{t("rollback")}
                  </Button>
                ) : "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </DashboardTableShell>
    </div>
  );
}
