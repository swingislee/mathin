"use client";

import { FollowupChoice } from "./dashboard-page/FollowupChoice";

import { FilterSearchInput } from "./FilterBar";

import { CalendarPlus2, Check, LoaderCircle, RefreshCw, UsersRound } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DashboardCommandActions,
  DashboardCommandFilters,
  DashboardCommandPanel,
  DashboardCommandSelection,
  DashboardCommandState,
  DashboardEmptyState,
  DashboardPage,
  DashboardSection,
  DashboardTableShell,
  StatusStrip,
} from "./dashboard-page";
import { useAction } from "@/components/action-form";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  createRenewalCycleAction,
  prepareRenewalOpportunitiesAction,
  setRenewalCycleStatusAction,
  snapshotRenewalCycleMembershipsAction,
} from "./actions/renewals";
import {
  RENEWAL_POOL_VIEWS,
  renewalPoolCounts,
  renewalPoolRowsForView,
  type RenewalPoolView,
  type RenewalStaffOption,
} from "./renewal-contract";
import type { RenewalWorkspaceData } from "./renewals";
import { FollowupTabs } from "./FollowupTabs";

const emptyErrors = { default: "" };

function localDate(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function localDateTime(value: string | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function RenewalPoolWorkspace({
  data,
  owners,
  canWrite,
}: {
  data: RenewalWorkspaceData;
  owners: RenewalStaffOption[];
  canWrite: boolean;
}) {
  const t = useTranslations("school.renewals");
  const locale = useLocale();
  const router = useRouter();
  const [view, setView] = useState<RenewalPoolView>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [cycleOpen, setCycleOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const selectedCycle = data.cycles.find((cycle) => cycle.id === data.selectedCycleId) ?? null;
  const renewalRows = data.opportunities.filter((row) => row.opportunityType === "renewal");
  const counts = renewalPoolCounts(renewalRows);
  const visibleRows = useMemo(() => renewalPoolRowsForView(renewalRows, {
    view,
    cycleId: selectedCycle?.id ?? null,
    query,
  }, locale), [locale, query, renewalRows, selectedCycle?.id, view]);

  const errors = {
    ...emptyErrors,
    default: t("actionFailed"),
    INVALID_TERM_SEQUENCE: t("invalidTermSequence"),
    INVALID_CYCLE_STATE: t("invalidCycleState"),
    INVALID_MEMBERSHIP: t("invalidMembership"),
    COURSE_REQUIRED: t("courseRequired"),
    OWNER_NOT_AVAILABLE: t("ownerUnavailable"),
    FORBIDDEN_OWNER_ASSIGNMENT: t("ownerAssignmentForbidden"),
  };

  const snapshot = useAction(snapshotRenewalCycleMembershipsAction, {
    successMessage: (result) => t("snapshotSuccess", result),
    errorMessage: errors,
    onSuccess: () => router.refresh(),
  });
  const cycleStatus = useAction(setRenewalCycleStatusAction, {
    successMessage: t("cycleStatusSaved"),
    errorMessage: errors,
    onSuccess: () => { setCloseOpen(false); router.refresh(); },
  });

  const allReadySelected = selected.size > 0 && [...selected].every((id) =>
    data.candidates.some((candidate) => candidate.membershipId === id && candidate.ready));
  const clearSelection = () => setSelected(new Set());

  return (
    <DashboardPage
      title={t("title")}
      description={t("intro")}
      commandPanel={
        <DashboardCommandPanel selection={selected.size > 0 ? (
          <DashboardCommandSelection>
            <span className="text-sm font-medium text-ink">{t("selectedCount", { count: selected.size })}</span>
            <Button size="sm" disabled={!allReadySelected} onClick={() => setPrepareOpen(true)}>
              <UsersRound className="size-4" />{t("prepareSelected")}
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>{t("clearSelection")}</Button>
          </DashboardCommandSelection>
        ) : undefined}>
          <DashboardCommandState><FollowupTabs /></DashboardCommandState>
          <DashboardCommandFilters>
            <Select value={selectedCycle?.id ?? "none"} onValueChange={(value) => {
              clearSelection();
              router.replace(value === "none" ? "/dashboard/followups/renewals" : `/dashboard/followups/renewals?cycle=${value}`);
            }}>
              <SelectTrigger className="w-full sm:w-56" aria-label={t("cycleFilter")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {data.cycles.length === 0 ? <SelectItem value="none">{t("noCycles")}</SelectItem> : null}
                {data.cycles.map((cycle) => <SelectItem key={cycle.id} value={cycle.id}>{cycle.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={view} onValueChange={(value) => setView(value as RenewalPoolView)}>
              <SelectTrigger className="w-full sm:w-36" aria-label={t("viewFilter")}><SelectValue /></SelectTrigger>
              <SelectContent>{RENEWAL_POOL_VIEWS.map((value) => (
                <SelectItem key={value} value={value}>{t(`view_${value}`)}</SelectItem>
              ))}</SelectContent>
            </Select>
            <FilterSearchInput value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder={t("searchPlaceholder")} />
          </DashboardCommandFilters>
          {canWrite ? <DashboardCommandActions>
            {selectedCycle && selectedCycle.status !== "closed" ? <Button
              size="sm"
              variant="secondary"
              disabled={snapshot.pending}
              onClick={() => snapshot.run(selectedCycle.id)}
            >{snapshot.pending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{t("refreshEligibility")}</Button> : null}
            {selectedCycle && selectedCycle.status !== "closed" ? <Button
              size="sm"
              variant="secondary"
              disabled={cycleStatus.pending}
              onClick={() => selectedCycle.status === "planning" ? cycleStatus.run(selectedCycle.id, "open") : setCloseOpen(true)}
            >{selectedCycle.status === "planning" ? t("openCycle") : t("closeCycle")}</Button> : null}
            <CreateCycleDialog
              open={cycleOpen}
              onOpenChange={setCycleOpen}
              terms={data.terms}
              errors={errors}
              onSaved={() => router.refresh()}
            />
          </DashboardCommandActions> : null}
        </DashboardCommandPanel>
      }
    >
      <StatusStrip items={[
        { label: t("view_active"), value: counts.active },
        { label: t("view_committed"), value: counts.committed },
        { label: t("view_closed"), value: counts.closed },
        { label: t("view_all"), value: counts.all },
      ]} />

      <DashboardSection
        title={t("cycleOverview")}
        description={selectedCycle
          ? t("cycleSummary", {
              source: selectedCycle.sourceTermName,
              target: selectedCycle.targetTermName,
              due: localDate(selectedCycle.decisionDueOn, locale),
            })
          : t("cycleEmptyHint")}
      >
        {selectedCycle ? <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div><span className="text-muted">{t("cycleStatus")}</span><div className="mt-1"><Badge variant="outline">{t(`cycleStatus_${selectedCycle.status}`)}</Badge></div></div>
          <div><span className="text-muted">{t("preparationStarts")}</span><p className="mt-1 text-ink">{localDate(selectedCycle.preparationStartsOn, locale)}</p></div>
          <div><span className="text-muted">{t("preparedCount")}</span><p className="mt-1 text-ink">{selectedCycle.opportunityCount}</p></div>
        </div> : <DashboardEmptyState>{t("noCycles")}</DashboardEmptyState>}
      </DashboardSection>

      {selectedCycle ? <DashboardSection title={t("eligibleStudents")} description={t("eligibleStudentsHint")}>
        <DashboardTableShell>
          <Table className="min-w-[52rem]">
            <TableHeader><TableRow>
              <TableHead className="w-12">{canWrite && selectedCycle.status === "open" ? <Checkbox
                aria-label={t("selectAll")}
                checked={data.candidates.length > 0 && data.candidates.filter((candidate) => candidate.ready).every((candidate) => selected.has(candidate.membershipId))}
                onCheckedChange={(checked) => setSelected(checked
                  ? new Set(data.candidates.filter((candidate) => candidate.ready).map((candidate) => candidate.membershipId))
                  : new Set())}
              /> : null}</TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("sourceClass")}</TableHead>
              <TableHead>{t("sourceCourse")}</TableHead>
              <TableHead>{t("currentOwner")}</TableHead>
              <TableHead>{t("readiness")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data.candidates.map((candidate) => <TableRow key={candidate.membershipId}>
                <TableCell>{canWrite && selectedCycle.status === "open" ? <Checkbox
                  aria-label={t("selectStudent", { name: candidate.studentName })}
                  checked={selected.has(candidate.membershipId)}
                  disabled={!candidate.ready}
                  onCheckedChange={(checked) => setSelected((current) => {
                    const next = new Set(current);
                    if (checked) next.add(candidate.membershipId); else next.delete(candidate.membershipId);
                    return next;
                  })}
                /> : null}</TableCell>
                <TableCell className="font-medium text-ink">{candidate.studentName}{candidate.grade ? <span className="ml-2 text-xs font-normal text-muted">{t("grade", { grade: candidate.grade })}</span> : null}</TableCell>
                <TableCell>{candidate.classroomName}</TableCell>
                <TableCell>{candidate.sourceCourseTitle || "—"}</TableCell>
                <TableCell>{candidate.currentOwnerName || "—"}</TableCell>
                <TableCell>{candidate.ready ? <Badge variant="secondary"><Check className="size-3" />{t("ready")}</Badge> : <Badge variant="outline">{t("courseRequired")}</Badge>}</TableCell>
              </TableRow>)}
              {data.candidates.length === 0 ? <TableRow><TableCell colSpan={6} className="h-36 text-center text-muted">{t("noEligibleStudents")}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </DashboardTableShell>
      </DashboardSection> : null}

      <DashboardSection title={t("renewalPool")} description={t("renewalPoolHint")}>
        <DashboardTableShell>
          <Table className="min-w-[64rem]">
            <TableHeader><TableRow>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("targetProduct")}</TableHead>
              <TableHead>{t("stage")}</TableHead>
              <TableHead>{t("owner")}</TableHead>
              <TableHead>{t("nextAction")}</TableHead>
              <TableHead>{t("nextActionAt")}</TableHead>
              <TableHead className="text-right">{t("details")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visibleRows.map((opportunity) => <TableRow key={opportunity.id}>
                <TableCell><p className="font-medium text-ink">{opportunity.studentName}</p><p className="text-xs text-muted">{opportunity.sourceClassroomName || opportunity.cycleName}</p></TableCell>
                <TableCell><p>{opportunity.courseTitle}</p><p className="text-xs text-muted">{opportunity.termName}</p></TableCell>
                <TableCell><Badge variant="outline">{t(`stage_${opportunity.stage}`)}</Badge></TableCell>
                <TableCell>{opportunity.ownerName}</TableCell>
                <TableCell className="max-w-72 whitespace-normal">{opportunity.nextAction || "—"}</TableCell>
                <TableCell>{localDateTime(opportunity.nextActionAt, locale)}</TableCell>
                <TableCell className="text-right"><Link className={cn(buttonVariants({ size: "sm", variant: "ghost" }))} href={`/dashboard/followups/renewals/${opportunity.id}`}>{t("openDetail")}</Link></TableCell>
              </TableRow>)}
              {visibleRows.length === 0 ? <TableRow><TableCell colSpan={7} className="h-40 text-center text-muted">{t("emptyPool")}</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </DashboardTableShell>
      </DashboardSection>

      <PrepareRenewalsDialog
        open={prepareOpen}
        onOpenChange={setPrepareOpen}
        cycleId={selectedCycle?.id ?? ""}
        membershipIds={[...selected]}
        owners={owners}
        errors={errors}
        onSaved={() => { clearSelection(); router.refresh(); }}
      />
      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={t("closeCycleTitle")}
        description={t("closeCycleDescription")}
        confirmLabel={t("closeCycleConfirm")}
        cancelLabel={t("cancel")}
        pending={cycleStatus.pending}
        onConfirm={() => selectedCycle && cycleStatus.run(selectedCycle.id, "closed")}
      />
    </DashboardPage>
  );
}

export function CreateCycleDialog({
  open,
  onOpenChange,
  terms,
  errors,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terms: RenewalWorkspaceData["terms"];
  errors: { default: string } & Record<string, string>;
  onSaved: () => void;
}) {
  const t = useTranslations("school.renewals");
  const [name, setName] = useState("");
  const [sourceTermId, setSourceTermId] = useState("");
  const [targetTermId, setTargetTermId] = useState("");
  const [preparationStartsOn, setPreparationStartsOn] = useState("");
  const [decisionDueOn, setDecisionDueOn] = useState("");
  const action = useAction(createRenewalCycleAction, {
    successMessage: t("cycleCreated"),
    errorMessage: errors,
    onSuccess: () => {
      onOpenChange(false);
      setName("");
      setSourceTermId("");
      setTargetTermId("");
      setPreparationStartsOn("");
      setDecisionDueOn("");
      onSaved();
    },
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild><Button size="sm"><CalendarPlus2 className="size-4" />{t("newCycle")}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("newCycle")}</DialogTitle><DialogDescription>{t("newCycleHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Label>{t("cycleName")}<Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></Label>
        <Label>{t("sourceTerm")}<FollowupChoice label={t("sourceTerm")} value={sourceTermId} onValueChange={setSourceTermId} options={terms.map((term) => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("targetTerm")}<FollowupChoice label={t("targetTerm")} value={targetTermId} onValueChange={setTargetTermId} options={terms.map((term) => ({ value: term.id, label: term.name }))} className="mt-1 w-full" /></Label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label>{t("preparationStarts")}<DateTimePicker className="mt-1" mode="date" value={preparationStartsOn} onValueChange={setPreparationStartsOn} /></Label>
          <Label>{t("decisionDue")}<DateTimePicker className="mt-1" mode="date" value={decisionDueOn} onValueChange={setDecisionDueOn} /></Label>
        </div>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button disabled={action.pending || !name.trim() || !sourceTermId || !targetTermId} onClick={() => action.run({
        name,
        sourceTermId,
        targetTermId,
        preparationStartsOn: preparationStartsOn || null,
        decisionDueOn: decisionDueOn || null,
      })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("create")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PrepareRenewalsDialog({
  open,
  onOpenChange,
  cycleId,
  membershipIds,
  owners,
  errors,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  membershipIds: string[];
  owners: RenewalStaffOption[];
  errors: { default: string } & Record<string, string>;
  onSaved: () => void;
}) {
  const t = useTranslations("school.renewals");
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? "");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const action = useAction(prepareRenewalOpportunitiesAction, {
    successMessage: (result) => t("prepareSuccess", result),
    errorMessage: errors,
    onSuccess: () => { onOpenChange(false); onSaved(); },
  });
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>{t("prepareTitle", { count: membershipIds.length })}</DialogTitle><DialogDescription>{t("prepareHint")}</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <Label>{t("owner")}<FollowupChoice label={t("owner")} value={ownerId} onValueChange={setOwnerId} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} className="mt-1 w-full" /></Label>
        <Label>{t("nextAction")}<Input className="mt-1" value={nextAction} onChange={(event) => setNextAction(event.target.value)} maxLength={500} placeholder={t("nextActionPlaceholder")} /></Label>
        <Label>{t("nextActionAt")}<DateTimePicker className="mt-1" mode="datetime" value={nextActionAt} onValueChange={setNextActionAt} /></Label>
      </div>
      <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button disabled={action.pending || !cycleId || !ownerId || !nextAction.trim() || !nextActionAt} onClick={() => action.run({ cycleId, membershipIds, ownerId, nextAction, nextActionAt })}>{action.pending ? <LoaderCircle className="size-4 animate-spin" /> : null}{t("prepareSelected")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
