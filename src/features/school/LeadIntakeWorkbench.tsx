"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardTableColumnHeader, DashboardTableShell, useDashboardTableView, type DashboardTableColumnDefinition } from "./dashboard-page";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { followupToneClasses, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { LeadIdentityControl } from "./LeadIdentityControl";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import type { LeadPoolRow } from "./lead-contract";

type IntakeColumn = "identity" | "source" | "owner" | "progress";

export function LeadIntakeWorkbench({ leads, locale, canAssign = false, canManageIdentity = false, currentUserId }: {
  leads: LeadPoolRow[];
  locale: string;
  canAssign?: boolean;
  canManageIdentity?: boolean;
  currentUserId?: string;
}) {
  const t = useTranslations("school.leads");
  const tableT = useTranslations("school.table");
  const invitationT = useTranslations("school.invitations");
  const selection = useLeadPoolSelection();
  const rangeRef = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }), [locale]);
  const formatAt = (value: string | null) => value ? dateTime.format(new Date(value)) : "—";
  const gradeOf = (lead: LeadPoolRow) => lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"));
  const progressOf = (lead: LeadPoolRow) => lead.activeInvitation ? invitationT(`state_${lead.activeInvitation.state}`) : t(`status_${lead.status}`);
  const progressValue = (lead: LeadPoolRow) => lead.activeInvitation ? `invitation:${lead.activeInvitation.state}` : `lead:${lead.status}`;
  const toneOf = (lead: LeadPoolRow): FollowupTone => lead.activeInvitation
    ? ["confirmed", "completed"].includes(lead.activeInvitation.state) ? "healthy" : lead.activeInvitation.state === "cancelled" ? "unhealthy" : "attention"
    : lead.status === "invalid" ? "unhealthy" : lead.status === "nurture" ? "attention" : ["contacted", "intent_confirmed", "converted"].includes(lead.status) ? "healthy" : "neutral";
  const columns: Record<IntakeColumn, DashboardTableColumnDefinition<LeadPoolRow>> = {
    identity: {
      filterValues: (lead) => [
        { value: `name:${lead.provisionalStudentName}`, label: lead.provisionalStudentName, group: tableT("fieldName") },
        { value: `phone:${lead.phone}`, label: lead.phone, group: tableT("fieldPhone") },
        { value: `grade:${gradeOf(lead)}`, label: gradeOf(lead), group: tableT("fieldGrade") },
        { value: `identity:${lead.status === "converted"}`, label: t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed"), group: tableT("fieldIdentity") },
        ...(lead.sourceMarkedDuplicate ? [{ value: "duplicate:true", label: t("sourceDuplicateShort"), group: tableT("fieldDuplicate") }] : []),
        ...(lead.suggestedStudentName ? [{ value: `suggested:${lead.suggestedStudentName}`, label: lead.suggestedStudentName, group: tableT("fieldSuggestedStudent") }] : []),
      ],
      sortValue: (lead) => lead.provisionalStudentName,
    },
    source: {
      filterValues: (lead) => [
        { value: `location:${lead.acquisitionLocation}`, label: lead.acquisitionLocation || t("acquisitionLocationMissing"), group: tableT("fieldLocation") },
        { value: `time:${lead.acquiredAt ?? "none"}`, label: lead.acquiredAt ? formatAt(lead.acquiredAt) : t("acquisitionTimeMissing"), group: tableT("fieldTime") },
        ...(lead.acquisitionPromoter ? [{ value: `promoter:${lead.acquisitionPromoter}`, label: lead.acquisitionPromoter, group: tableT("fieldPromoter") }] : []),
        ...(lead.acquisitionMethod ? [{ value: `method:${lead.acquisitionMethod}`, label: lead.acquisitionMethod, group: tableT("fieldMethod") }] : []),
        { value: `count:${lead.sourceCount}`, label: t("sourceCount", { count: lead.sourceCount }), group: tableT("fieldSourceCount") },
        ...lead.interests.map((value) => ({ value: `interest:${value}`, label: value, group: tableT("fieldInterest") })),
      ],
      sortValue: (lead) => lead.acquiredAt,
    },
    owner: { filterValues: (lead) => ({ value: lead.ownerId ?? "$unassigned", label: lead.ownerName || t("unassignedOwner") }), sortValue: (lead) => lead.ownerName },
    progress: {
      filterValues: (lead) => [{ value: progressValue(lead), label: progressOf(lead) }, ...(lead.lastContactOutcome ? [{ value: `contact:${lead.lastContactOutcome}`, label: t(`contactOutcome_${lead.lastContactOutcome}`), group: tableT("fieldContactResult") }] : [])],
      sortValue: progressOf,
    },
  };
  const table = useDashboardTableView({ rows: leads, columns, locale, persistenceKey: `school.followup.lead-intake.${currentUserId ?? "user"}` });
  const visibleIds = table.visibleRows.filter((lead) => !["invalid", "converted"].includes(lead.status)).map((lead) => lead.id);
  const selectedCount = visibleIds.filter((id) => selection.selected.has(id)).length;
  const changeDetails = (id: string, open: boolean) => {
    setExpandedId(open ? id : null);
    if (!open) rowRefs.current.get(id)?.focus({ preventScroll: true });
  };
  const colSpan = canAssign ? 6 : 5;

  return <DashboardTableShell><Table className="w-full min-w-[48rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
    <colgroup>{canAssign ? <col style={{ width: "2rem" }} /> : null}<col style={{ width: "22%" }} /><col style={{ width: "25%" }} /><col style={{ width: "11%" }} /><col style={{ width: "16%" }} /><col /></colgroup>
    <TableHeader><TableRow>
      {canAssign ? <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><Checkbox checked={visibleIds.length > 0 && selectedCount === visibleIds.length ? true : selectedCount > 0 ? "indeterminate" : false} disabled={!visibleIds.length || selection.assignmentPending} onCheckedChange={(checked) => selection.setVisibleSelection(visibleIds, checked === true)} aria-label={t("selectPage")} /></TableHead> : null}
      <TableHead className={cn("sticky top-0 z-30 h-9 border-r border-line bg-card px-2", canAssign ? "left-8" : "left-0")}><DashboardTableColumnHeader label={t("seed")} {...table.columnProps("identity")} /></TableHead>
      <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("sourceDetails")} {...table.columnProps("source")} /></TableHead>
      <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("owner")} {...table.columnProps("owner")} /></TableHead>
      <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={t("intakeProgress")} {...table.columnProps("progress")} /></TableHead>
      <TableHead className="sticky top-0 z-20 h-9 bg-card px-2">{t("actions")}</TableHead>
    </TableRow></TableHeader>
    <TableBody>{table.visibleRows.map((lead) => {
      const open = expandedId === lead.id;
      const detailsId = `lead-source-${lead.id}`;
      const sourceAttribution = [lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "", lead.acquisitionMethod, t("sourceCount", { count: lead.sourceCount })].filter(Boolean).join(" · ");
      const communicationLabel = t(lead.contactCount || lead.activeInvitation ? "continueCommunication" : "openCommunication");
      return <Fragment key={lead.id}>
        <TableRow ref={(node) => { if (node) rowRefs.current.set(lead.id, node); else rowRefs.current.delete(lead.id); }} tabIndex={0} aria-expanded={open} aria-controls={detailsId} className={cn("h-16 focus-visible:outline-none focus-visible:bg-blue/10 [&>td]:min-w-0 [&>td]:px-2 [&>td]:py-2", (open || selection.selected.has(lead.id)) && "bg-blue/5")}
          onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,[role='checkbox']")) changeDetails(lead.id, !open); }}
          onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); changeDetails(lead.id, !open); } if (event.key === "Escape" && open) { event.preventDefault(); changeDetails(lead.id, false); } }}>
          {canAssign ? <TableCell><Checkbox checked={selection.selected.has(lead.id)} disabled={selection.assignmentPending || ["invalid", "converted"].includes(lead.status)} onClick={(event) => { rangeRef.current = event.shiftKey; }} onCheckedChange={(checked) => { selection.toggleLead(lead.id, checked === true, visibleIds, rangeRef.current); rangeRef.current = false; }} aria-label={t("selectLead", { name: lead.provisionalStudentName })} /></TableCell> : null}
          <TableCell className={cn("sticky z-10 border-r border-line bg-card", canAssign ? "left-8" : "left-0")}><div className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-ink" title={lead.provisionalStudentName}>{lead.provisionalStudentName}</span><span className="max-w-[50%] truncate text-[10px] text-muted" title={gradeOf(lead)}>{gradeOf(lead)}</span></div><div className="mt-1 flex min-w-0 items-center gap-2"><a className="shrink-0 font-mono text-[10px] hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a>{lead.sourceMarkedDuplicate ? <span className="truncate text-[10px] text-rose">{t("sourceDuplicateShort")}</span> : null}</div></TableCell>
          <TableCell><p className="truncate" title={lead.acquisitionLocation}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</p><p className="mt-1 truncate text-[11px] text-muted" title={sourceAttribution}>{formatAt(lead.acquiredAt)}{lead.interests.length ? ` · ${lead.interests.join(" / ")}` : ""}</p></TableCell>
          <TableCell className="truncate" title={lead.ownerName}>{lead.ownerName || t("unassignedOwner")}</TableCell>
          <TableCell><Badge variant="outline" className={cn("max-w-full truncate px-1.5 text-[11px]", followupToneClasses[toneOf(lead)])} title={progressOf(lead)}>{progressOf(lead)}</Badge>{lead.activeInvitation ? <p className="mt-1 truncate text-[11px] text-muted">{invitationT(`kind_${lead.activeInvitation.kind}`)}</p> : null}</TableCell>
          <TableCell><div className="flex min-w-0 items-center justify-end gap-1"><Link href={`/dashboard/followups/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-8 min-w-0 gap-1 px-1.5 text-xs")} title={communicationLabel}><span className="truncate">{communicationLabel}</span><ArrowRight className="size-3.5 shrink-0" /></Link><Button size="sm" variant="ghost" className="size-7 shrink-0 p-0" aria-label={t("sourceDetails")} title={t("sourceDetails")} aria-expanded={open} aria-controls={detailsId} onClick={() => changeDetails(lead.id, !open)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>{canManageIdentity ? <span title={t("confirmIdentity")} className="shrink-0 [&>button]:size-7 [&>button]:gap-0 [&>button]:p-0 [&>button]:text-[0px]"><LeadIdentityControl lead={lead} /></span> : null}</div></TableCell>
        </TableRow>
        <FollowupInlineDetails open={open} onOpenChange={(value) => changeDetails(lead.id, value)} title={`${lead.provisionalStudentName} · ${t("sourceDetails")}`} colSpan={colSpan} id={detailsId}>
          <div className="grid min-w-0 gap-5 @3xl/followup-entry:grid-cols-2">
            <section className="min-w-0 space-y-3"><dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs"><dt className="text-muted">{t("acquisitionLocation")}</dt><dd>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</dd><dt className="text-muted">{t("acquiredAt")}</dt><dd>{formatAt(lead.acquiredAt)}</dd><dt className="text-muted">{tableT("fieldPromoter")}</dt><dd>{lead.acquisitionPromoter || "—"}</dd><dt className="text-muted">{tableT("fieldMethod")}</dt><dd>{lead.acquisitionMethod || "—"}</dd><dt className="text-muted">{tableT("fieldSourceCount")}</dt><dd>{lead.sourceCount}</dd><dt className="text-muted">{t("interests")}</dt><dd>{lead.interests.join(" / ") || "—"}</dd></dl><p className="text-xs text-muted">{t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed")}{lead.sourceMarkedDuplicate ? ` · ${t("sourceDuplicate")}` : ""}</p>{lead.suggestedStudentName ? <p className="text-xs text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p> : null}</section>
            <section className="min-w-0 space-y-3 @3xl/followup-entry:border-l @3xl/followup-entry:border-line @3xl/followup-entry:pl-5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t("latestContact")}</span>{lead.lastContactOutcome ? <Badge variant="outline">{t(`contactOutcome_${lead.lastContactOutcome}`)}</Badge> : null}<span className="text-[11px] text-muted">{lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted")}</span><span className="text-[11px] text-muted">{t("contactCount", { count: lead.contactCount })}</span></div><p className="whitespace-pre-wrap break-words text-xs leading-5">{lead.lastContactNote || t("noContactNote")}</p><div className="flex flex-wrap gap-2">{lead.interestLevel ? <Badge variant="outline">{t(`interest_${lead.interestLevel}`)}</Badge> : null}{lead.wechatAdded !== null ? <Badge variant="outline">{t(lead.wechatAdded ? "wechatAdded" : "wechatNotAdded")}</Badge> : null}{lead.visitCommitted !== null ? <Badge variant="outline">{t(lead.visitCommitted ? "visitCommitted" : "visitNotCommitted")}</Badge> : null}</div>{lead.activeInvitation ? <div className="space-y-1 text-xs"><p>{invitationT(`kind_${lead.activeInvitation.kind}`)} · {progressOf(lead)}</p><p>{[lead.activeInvitation.activityTitle, lead.activeInvitation.assessorName, lead.activeInvitation.locationText].filter(Boolean).join(" · ")}</p>{lead.activeInvitation.scheduledAt ? <p>{formatAt(lead.activeInvitation.scheduledAt)}</p> : null}</div> : null}{lead.nextContactAt ? <p className="text-xs text-muted">{invitationT("nextContactReminderScheduled", { time: formatAt(lead.nextContactAt) })}</p> : null}<Link href={`/dashboard/followups/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "secondary" }), "h-8 text-xs")}>{communicationLabel}<ArrowRight className="size-3.5" /></Link></section>
          </div>
        </FollowupInlineDetails>
      </Fragment>;
    })}{!table.visibleRows.length ? <TableRow><TableCell colSpan={colSpan} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
  </Table></DashboardTableShell>;
}
