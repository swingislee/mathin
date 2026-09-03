"use client";

import { LoaderCircle, MessageSquarePlus, PhoneCall } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useRouter } from "@/i18n/navigation";
import { recordLeadContactAction, type LeadContactInput } from "./actions/leads";
import { fromSelectValue, toSelectValue } from "./controls";
import {
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableFilterOption,
} from "./dashboard-page";
import {
  filterAndSortLeadRows,
  leadGradeFilterKey,
  NO_CONTACT_FILTER,
  NO_OWNER_FILTER,
  type LeadTableColumn,
  type LeadTableFilters,
  type LeadTableSort,
  UNKNOWN_GRADE_FILTER,
} from "./lead-table-view";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import { LEAD_STATUSES, type LeadPoolRow } from "./lead-contract";

const CONTACT_OUTCOMES = ["unreachable", "connected", "declined", "invalid_number"] as const;

function ContactDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadPoolRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [outcome, setOutcome] = useState<LeadContactInput["outcome"] | "">("");
  const [note, setNote] = useState("");
  const [wechatState, setWechatState] = useState("");
  const [visitState, setVisitState] = useState("");
  const [interestLevel, setInterestLevel] = useState("");

  const reset = () => {
    setOutcome("");
    setNote("");
    setWechatState("");
    setVisitState("");
    setInterestLevel("");
  };
  const contactRun = useAction(recordLeadContactAction, {
    successMessage: t("contactSaved"),
    errorMessage: {
      LEAD_UNASSIGNED: t("contactNeedsOwner"),
      LEAD_CLOSED: t("contactClosed"),
      default: t("contactFailed"),
    },
    onSuccess: () => {
      reset();
      onOpenChange(false);
      router.refresh();
    },
  });

  const reachable = outcome === "connected" || outcome === "declined";
  const submit = () => {
    if (!lead || !outcome) return;
    contactRun.run(lead.id, {
      outcome,
      note,
      wechatAdded: reachable ? (wechatState === "yes" ? true : wechatState === "no" ? false : null) : null,
      visitCommitted: outcome === "connected" ? (visitState === "yes" ? true : visitState === "no" ? false : null) : null,
      interestLevel: interestLevel === "A" || interestLevel === "B" || interestLevel === "C" ? interestLevel : null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !contactRun.pending) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? t("contactTitle", { name: lead.provisionalStudentName }) : t("contactTitleFallback")}</DialogTitle>
        </DialogHeader>
        {lead ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium text-ink">{lead.phone}</span>
              <span className="text-muted">{lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}</span>
            </div>
            <p className="text-xs leading-5 text-muted">{t("contactAutoFields")}</p>
            <Separator />
            <div className="grid gap-4 sm:grid-cols-2">
              <Label className="grid gap-1.5 text-sm font-normal">
                <span>{t("contactOutcome")}</span>
                <Select
                  value={outcome || undefined}
                  onValueChange={(value) => {
                    const next = value as LeadContactInput["outcome"];
                    setOutcome(next);
                    if (next === "unreachable" || next === "invalid_number") {
                      setWechatState("");
                      setVisitState("");
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={t("contactOutcomePlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    {(["unreachable", "connected", "declined", "invalid_number"] as const).map((value) => (
                      <SelectItem key={value} value={value}>{t(`contactOutcome_${value}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1.5 text-sm font-normal">
                <span>{t("interestLevel")}</span>
                <Select value={toSelectValue(interestLevel)} onValueChange={(value) => setInterestLevel(fromSelectValue(value))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("interestUnrated")}</SelectItem>
                    {(["A", "B", "C"] as const).map((value) => (
                      <SelectItem key={value} value={value}>{t(`interest_${value}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1.5 text-sm font-normal">
                <span>{t("wechatFact")}</span>
                <Select value={toSelectValue(wechatState)} onValueChange={(value) => setWechatState(fromSelectValue(value))} disabled={!reachable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("notDiscussed")}</SelectItem>
                    <SelectItem value="yes">{t("wechatAdded")}</SelectItem>
                    <SelectItem value="no">{t("wechatNotAdded")}</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1.5 text-sm font-normal">
                <span>{t("visitFact")}</span>
                <Select value={toSelectValue(visitState)} onValueChange={(value) => setVisitState(fromSelectValue(value))} disabled={outcome !== "connected"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={toSelectValue("")}>{t("notDiscussed")}</SelectItem>
                    <SelectItem value="yes">{t("visitCommitted")}</SelectItem>
                    <SelectItem value="no">{t("visitNotCommitted")}</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              <Label className="grid gap-1.5 text-sm font-normal sm:col-span-2">
                <span>{t("contactNote")}</span>
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder={t("contactNotePlaceholder")}
                />
              </Label>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={contactRun.pending} onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="button" disabled={!lead || !outcome || contactRun.pending} onClick={submit}>
            {contactRun.pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <PhoneCall className="size-4" />}
            {t("saveContact")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeadPoolTable({
  leads,
  locale,
  currentUserId,
  canAssign,
  canContact,
  canContactAll,
}: {
  leads: LeadPoolRow[];
  locale: string;
  currentUserId: string;
  canAssign: boolean;
  canContact: boolean;
  canContactAll: boolean;
}) {
  const t = useTranslations("school.leads");
  const [contactTarget, setContactTarget] = useState<LeadPoolRow | null>(null);
  const extendRangeRef = useRef(false);
  const [columnFilters, setColumnFilters] = useState<LeadTableFilters>({});
  const [sort, setSort] = useState<LeadTableSort | null>(null);
  const {
    selected,
    assignmentPending,
    toggleLead,
    setVisibleSelection,
  } = useLeadPoolSelection();
  const visibleLeads = useMemo(
    () => filterAndSortLeadRows(leads, columnFilters, sort, locale),
    [columnFilters, leads, locale, sort],
  );
  const visibleAssignableIds = useMemo(
    () => visibleLeads
      .filter((lead) => lead.status !== "invalid" && lead.status !== "converted")
      .map((lead) => lead.id),
    [visibleLeads],
  );
  const selectedVisibleCount = visibleAssignableIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = visibleAssignableIds.length > 0
    && selectedVisibleCount === visibleAssignableIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;
  const formatAt = (value: string) => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

  const columnOptions = useMemo<Record<LeadTableColumn, DashboardTableFilterOption[]>>(() => {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const sortOptions = (options: DashboardTableFilterOption[]) => options
      .sort((left, right) => collator.compare(left.label, right.label));
    const grades = new Map<string, string>();
    const interests = new Set<string>();
    const owners = new Map<string, string>();
    let hasUnassignedOwner = false;
    let hasNoContact = false;

    for (const lead of leads) {
      const gradeKey = leadGradeFilterKey(lead);
      grades.set(
        gradeKey,
        gradeKey === UNKNOWN_GRADE_FILTER
          ? t("unknownGrade")
          : lead.gradeText.trim() || t("gradeValue", { grade: lead.gradeHint ?? "" }),
      );
      for (const interest of lead.interests) interests.add(interest);
      if (lead.ownerId) owners.set(lead.ownerId, lead.ownerName || t("unassignedOwner"));
      else hasUnassignedOwner = true;
      if (!lead.lastContactOutcome) hasNoContact = true;
    }

    return {
      seed: sortOptions([...grades].map(([value, label]) => ({ value, label }))),
      interests: sortOptions([...interests].map((value) => ({ value, label: value }))),
      owner: sortOptions([
        ...(hasUnassignedOwner ? [{ value: NO_OWNER_FILTER, label: t("unassignedOwner") }] : []),
        ...[...owners].map(([value, label]) => ({ value, label })),
      ]),
      latestContact: [
        ...(hasNoContact ? [{ value: NO_CONTACT_FILTER, label: t("notContacted") }] : []),
        ...CONTACT_OUTCOMES.map((value) => ({ value, label: t(`contactOutcome_${value}`) })),
      ],
      status: LEAD_STATUSES.map((value) => ({ value, label: t(`status_${value}`) })),
    };
  }, [leads, locale, t]);

  const setColumnFilter = (column: LeadTableColumn, value: string | undefined) => {
    setColumnFilters((current) => {
      const next = { ...current };
      if (value) next[column] = value;
      else delete next[column];
      return next;
    });
  };
  const clearColumn = (column: LeadTableColumn) => {
    setColumnFilter(column, undefined);
    setSort((current) => current?.column === column ? null : current);
  };
  const columnHeader = (column: LeadTableColumn, label: string) => (
    <DashboardTableColumnHeader
      label={label}
      labels={{
        menu: t("columnMenu", { column: label }),
        scope: t("columnMenuScope"),
        sortAscending: t("sortAscending"),
        sortDescending: t("sortDescending"),
        filter: t("filterColumn", { column: label }),
        allValues: t("allColumnValues"),
        clear: t("clearColumn"),
      }}
      filterValue={columnFilters[column]}
      filterOptions={columnOptions[column]}
      sortDirection={sort?.column === column ? sort.direction : undefined}
      onFilterChange={(value) => setColumnFilter(column, value)}
      onSortChange={(direction) => setSort({ column, direction })}
      onClear={() => clearColumn(column)}
    />
  );

  return (
    <>
      <DashboardTableShell>
        <Table
          className="w-full min-w-[68rem] text-xs"
          containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto"
        >
          <TableHeader>
            <TableRow>
              {canAssign ? (
                <TableHead className="sticky top-0 z-20 h-8 w-9 bg-card px-2">
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Checkbox
                          checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                          disabled={visibleAssignableIds.length === 0 || assignmentPending}
                          onCheckedChange={(checked) => setVisibleSelection(visibleAssignableIds, checked === true)}
                          aria-label={t("selectPage")}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-72 leading-5">
                        {t("rangeSelectionHint")}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
              ) : null}
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("seed", t("seed"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("interests", t("interests"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("owner", t("owner"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("latestContact", t("latestContact"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{columnHeader("status", t("status"))}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 w-24 bg-card px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLeads.map((lead) => {
              const assignable = lead.status !== "invalid" && lead.status !== "converted";
              const contactable = canContact && Boolean(lead.ownerId)
                && (lead.ownerId === currentUserId || canContactAll);
              return (
                <TableRow key={lead.id} className={selected.has(lead.id) ? "bg-moon/20" : undefined}>
                  {canAssign ? (
                    <TableCell className="w-9 px-2 py-1.5">
                      <Checkbox
                        checked={selected.has(lead.id)}
                        disabled={!assignable || assignmentPending}
                        onClick={(event) => { extendRangeRef.current = event.shiftKey; }}
                        onCheckedChange={(checked) => {
                          toggleLead(
                            lead.id,
                            checked === true,
                            visibleAssignableIds,
                            extendRangeRef.current,
                          );
                          extendRangeRef.current = false;
                        }}
                        aria-label={t("selectLead", { name: lead.provisionalStudentName })}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className="min-w-60 px-2 py-1.5">
                    <div className="flex items-baseline gap-2 whitespace-nowrap">
                      <span className="font-medium text-ink">{lead.provisionalStudentName}</span>
                      <span className="font-mono text-[11px] text-muted">{lead.phone}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-muted">
                      <span>{lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t("identityUnconfirmed")}</span>
                      {lead.sourceMarkedDuplicate ? <Badge variant="danger" className="px-1.5 py-0 text-[11px] font-normal leading-4">{t("sourceDuplicateShort")}</Badge> : null}
                    </div>
                    {lead.suggestedStudentName ? (
                      <p className="mt-0.5 text-[11px] leading-4 text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-64 px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {lead.interests.length > 0
                        ? lead.interests.map((interest) => <Badge key={interest} variant="outline" className="px-1.5 py-0 text-[11px] font-normal leading-4">{interest}</Badge>)
                        : <span className="text-muted">—</span>}
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1.5">{lead.ownerName || t("unassignedOwner")}</TableCell>
                  <TableCell className="min-w-64 px-2 py-1.5">
                    {lead.lastContactAt && lead.lastContactOutcome ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-ink">{t(`contactOutcome_${lead.lastContactOutcome}`)}</span>
                          <span className="text-[11px] text-muted">{formatAt(lead.lastContactAt)}</span>
                          {lead.interestLevel ? <Badge variant="secondary" className="px-1.5 py-0 text-[11px] leading-4">{lead.interestLevel}</Badge> : null}
                          {lead.wechatAdded === true ? <Badge variant="outline" className="px-1.5 py-0 text-[11px] leading-4">{t("wechatAddedShort")}</Badge> : null}
                          {lead.visitCommitted === true ? <Badge variant="outline" className="px-1.5 py-0 text-[11px] leading-4">{t("visitCommittedShort")}</Badge> : null}
                        </div>
                        <p className="mt-0.5 max-w-64 truncate text-[11px] leading-4 text-muted" title={lead.lastContactNote || undefined}>
                          {lead.lastContactNote || (lead.contactCount > 1 ? t("contactCount", { count: lead.contactCount }) : t("noContactNote"))}
                        </p>
                      </>
                    ) : <span className="text-muted">{t("notContacted")}</span>}
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    <Badge className="px-1.5 py-0 text-[11px] leading-4" variant={lead.status === "invalid" ? "danger" : lead.status === "converted" ? "secondary" : "outline"}>
                      {t(`status_${lead.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-2 py-1.5">
                    {contactable ? (
                      <Button type="button" variant="ghost" size="sm" className="h-7 whitespace-nowrap px-2 text-xs" onClick={() => setContactTarget(lead)}>
                        <MessageSquarePlus className="size-4" />
                        {lead.contactCount > 0 ? t("recordContact") : t("recordFirstContact")}
                      </Button>
                    ) : lead.ownerId ? <span className="text-xs text-muted">—</span> : <span className="text-xs text-muted">{t("assignBeforeContact")}</span>}
                  </TableCell>
                </TableRow>
              );
            })}
            {visibleLeads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canAssign ? 7 : 6}
                  className="h-32 px-4 text-center text-sm text-muted"
                >
                  {t("columnEmpty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
      <ContactDialog
        key={contactTarget?.id ?? "none"}
        lead={contactTarget}
        open={contactTarget !== null}
        onOpenChange={(next) => { if (!next) setContactTarget(null); }}
      />
    </>
  );
}
