"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Copy, HeartPulse, MapPin } from "lucide-react";
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
import { FollowupEntryLayout } from "./FollowupEntryFields";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import { followupKeyContext, navigateFollowupTable } from "./followup-keyboard";
import { Student360Trigger } from "./Student360Sheet";
import type { LeadPoolRow } from "./lead-contract";

type IntakeColumn = "identity" | "phone" | "grade" | "source" | "acquiredAt" | "owner" | "progress";

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }), [locale]);
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "Asia/Shanghai" }), [locale]);
  const formatAt = (value: string | null, dateOnly = false) => value && Number.isFinite(Date.parse(value)) ? (dateOnly ? date : dateTime).format(new Date(value)) : "—";
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
        { value: `identity:${lead.status === "converted"}`, label: t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed"), group: tableT("fieldIdentity") },
        ...(lead.sourceMarkedDuplicate ? [{ value: "duplicate:true", label: t("sourceDuplicateShort"), group: tableT("fieldDuplicate") }] : []),
        ...(lead.suggestedStudentName ? [{ value: `suggested:${lead.suggestedStudentName}`, label: lead.suggestedStudentName, group: tableT("fieldSuggestedStudent") }] : []),
      ],
      sortValue: (lead) => lead.provisionalStudentName,
    },
    phone: { filterValues: (lead) => ({ value: lead.phone || "$missing", label: lead.phone || "—" }), sortValue: (lead) => lead.phone },
    grade: { filterValues: (lead) => ({ value: gradeOf(lead), label: gradeOf(lead) }), sortValue: gradeOf },
    source: {
      filterValues: (lead) => [
        { value: `location:${lead.acquisitionLocation}`, label: lead.acquisitionLocation || t("acquisitionLocationMissing"), group: tableT("fieldLocation") },
        ...(lead.acquisitionPromoter ? [{ value: `promoter:${lead.acquisitionPromoter}`, label: lead.acquisitionPromoter, group: tableT("fieldPromoter") }] : []),
        ...(lead.acquisitionMethod ? [{ value: `method:${lead.acquisitionMethod}`, label: lead.acquisitionMethod, group: tableT("fieldMethod") }] : []),
        { value: `count:${lead.sourceCount}`, label: t("sourceCount", { count: lead.sourceCount }), group: tableT("fieldSourceCount") },
        ...lead.interests.map((value) => ({ value: `interest:${value}`, label: value, group: tableT("fieldInterest") })),
      ],
      sortValue: (lead) => lead.acquisitionLocation,
    },
    acquiredAt: { filterValues: (lead) => ({ value: formatAt(lead.acquiredAt, true), label: lead.acquiredAt ? formatAt(lead.acquiredAt, true) : t("acquisitionTimeMissing") }), sortValue: (lead) => lead.acquiredAt },
    owner: { filterValues: (lead) => ({ value: lead.ownerId ?? "$unassigned", label: lead.ownerName || t("unassignedOwner") }), sortValue: (lead) => lead.ownerName },
    progress: {
      filterValues: (lead) => [{ value: progressValue(lead), label: progressOf(lead) }, ...(lead.lastContactOutcome ? [{ value: `contact:${lead.lastContactOutcome}`, label: t(`contactOutcome_${lead.lastContactOutcome}`), group: tableT("fieldContactResult") }] : [])],
      sortValue: progressOf,
    },
  };
  const table = useDashboardTableView({ rows: leads, columns, locale, persistenceKey: `school.followup.lead-intake.compact-v2.${currentUserId ?? "user"}` });
  const visibleIds = table.visibleRows.filter((lead) => !["invalid", "converted"].includes(lead.status)).map((lead) => lead.id);
  const visibleKey = visibleIds.join(",");
  const { setVisibleIds } = selection;
  // 命令栏明确显示被列筛选隐藏的已选项，分配范围始终可核对。
  useEffect(() => { setVisibleIds(visibleKey ? visibleKey.split(",") : []); }, [setVisibleIds, visibleKey]);
  const selectedCount = visibleIds.filter((id) => selection.selected.has(id)).length;
  const changeDetails = (id: string, open: boolean) => {
    if (selection.assignmentPending) return;
    setActiveId(id);
    setExpandedId(open ? id : null);
    if (!open) rowRefs.current.get(id)?.focus({ preventScroll: true });
  };
  const colSpan = canAssign ? 9 : 8;
  const headerLabels = { scope: t("columnMenuScope") };

  return <DashboardTableShell data-lead-intake-workbench data-followup-workbench data-followup-scroll>
    <Table className="w-full min-w-[58rem] table-fixed text-xs" containerClassName="overflow-auto [scrollbar-gutter:stable]"
      onKeyDown={(event) => navigateFollowupTable(event, (id) => {
        if (selection.assignmentPending) return false;
        setActiveId(id);
        if (expandedId) setExpandedId(id);
        return true;
      })}>
    <colgroup>{canAssign ? <col className="w-8" /> : null}<col className="w-44" /><col className="w-32" /><col className="w-20" /><col /><col className="w-28" /><col className="w-28" /><col className="w-32" /><col className="w-10" /></colgroup>
    <TableHeader inert={selection.assignmentPending || undefined}><TableRow className="[&>th]:h-9 [&>th]:px-2">
      {canAssign ? <TableHead className="sticky left-0 top-0 z-30 bg-card"><Checkbox checked={visibleIds.length > 0 && selectedCount === visibleIds.length ? true : selectedCount > 0 ? "indeterminate" : false} disabled={!visibleIds.length || selection.assignmentPending} onCheckedChange={(checked) => selection.setVisibleSelection(visibleIds, checked === true)} aria-label={t("selectPage")} title={t("rangeSelectionHint")} /></TableHead> : null}
      <TableHead className={cn("sticky top-0 z-30 border-r border-line bg-card", canAssign ? "left-8" : "left-0")}><DashboardTableColumnHeader label={tableT("fieldName")} labels={headerLabels} {...table.columnProps("identity")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={tableT("fieldPhone")} labels={headerLabels} {...table.columnProps("phone")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("grade")} labels={headerLabels} {...table.columnProps("grade")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("acquisitionLocation")} labels={headerLabels} {...table.columnProps("source")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("acquiredAt")} labels={headerLabels} {...table.columnProps("acquiredAt")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("owner")} labels={headerLabels} {...table.columnProps("owner")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("intakeProgress")} labels={headerLabels} {...table.columnProps("progress")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><span className="sr-only">{t("actions")}</span></TableHead>
    </TableRow></TableHeader>
    <TableBody>{table.visibleRows.map((lead) => {
      const open = expandedId === lead.id;
      const detailsId = `lead-source-${lead.id}`;
      const sourceAttribution = [lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "", lead.acquisitionMethod, t("sourceCount", { count: lead.sourceCount })].filter(Boolean).join(" · ");
      const communicationLabel = t(lead.contactCount || lead.activeInvitation ? "continueCommunication" : "openCommunication");
      return <Fragment key={lead.id}>
        <TableRow ref={(node) => { if (node) rowRefs.current.set(lead.id, node); else rowRefs.current.delete(lead.id); }}
          data-lead-intake-row={lead.id} data-followup-row-key={lead.id} data-followup-active={activeId === lead.id || open} data-followup-expanded={open}
          tabIndex={0} aria-expanded={open} aria-controls={detailsId} aria-selected={canAssign ? selection.selected.has(lead.id) : undefined} aria-busy={selection.assignmentPending}
          className="h-9 cursor-pointer [&>td]:min-w-0 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1 [&:focus-visible_[data-lead-details-trigger]]:outline-2 [&:focus-visible_[data-lead-details-trigger]]:outline-crater"
          onFocus={() => setActiveId(lead.id)}
          onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,select,textarea,[role='checkbox']")) changeDetails(lead.id, !open); }}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || followupKeyContext(event).overlay) return;
            if (event.target === event.currentTarget && !event.altKey && !event.ctrlKey && !event.metaKey) {
              if (event.key === "Enter") { event.preventDefault(); changeDetails(lead.id, !open); }
              if (event.key === " " && canAssign && !["invalid", "converted"].includes(lead.status)) { event.preventDefault(); selection.toggleLead(lead.id, !selection.selected.has(lead.id), visibleIds, event.shiftKey); }
            }
            if (event.key === "Escape" && open) { event.preventDefault(); changeDetails(lead.id, false); }
          }}>
          {canAssign ? <TableCell className="sticky left-0 z-10"><Checkbox checked={selection.selected.has(lead.id)} disabled={selection.assignmentPending || ["invalid", "converted"].includes(lead.status)} onClick={(event) => { rangeRef.current = event.shiftKey; }} onCheckedChange={(checked) => { selection.toggleLead(lead.id, checked === true, visibleIds, rangeRef.current); rangeRef.current = false; }} aria-label={t("selectLead", { name: lead.provisionalStudentName })} /></TableCell> : null}
          <TableCell className={cn("sticky z-10 border-r border-line", canAssign ? "left-8" : "left-0")}>
            <div className="flex min-w-0 items-center gap-1" data-followup-person>
              <Button type="button" size="sm" variant="ghost" data-lead-details-trigger className="size-5 shrink-0 rounded-sm p-0" aria-label={`${t("sourceDetails")} · ${lead.provisionalStudentName}`} title={t("sourceDetails")} aria-expanded={open} aria-controls={detailsId} disabled={selection.assignmentPending} onClick={() => changeDetails(lead.id, !open)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button>
              <Student360Trigger subject={{ leadId: lead.id, studentId: lead.studentId ?? null }} fallback={{ name: lead.provisionalStudentName, phone: lead.phone, grade: lead.gradeHint, gradeText: gradeOf(lead) }} className="truncate">{lead.provisionalStudentName}</Student360Trigger>
              {lead.sourceMarkedDuplicate ? <span title={t("sourceDuplicate")} className="shrink-0 text-rose"><Copy className="size-3" aria-label={t("sourceDuplicateShort")} /></span> : null}
            </div>
          </TableCell>
          <TableCell><a className="font-mono text-[11px] hover:underline" href={`tel:${lead.phone}`}>{lead.phone || "—"}</a></TableCell>
          <TableCell className="truncate text-muted" title={gradeOf(lead)}>{gradeOf(lead)}</TableCell>
          <TableCell className="truncate" title={[lead.acquisitionLocation, sourceAttribution, lead.interests.join(" / ")].filter(Boolean).join(" · ")}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</TableCell>
          <TableCell className="tabular-nums text-muted" title={formatAt(lead.acquiredAt)}>{formatAt(lead.acquiredAt, true)}</TableCell>
          <TableCell className="truncate" title={lead.ownerName}>{lead.ownerName || t("unassignedOwner")}</TableCell>
          <TableCell><Badge variant="outline" className={cn("max-w-full truncate px-1.5 py-0 text-[11px] leading-5", followupToneClasses[toneOf(lead)])} title={[progressOf(lead), lead.activeInvitation ? invitationT(`kind_${lead.activeInvitation.kind}`) : "", lead.lastContactNote].filter(Boolean).join(" · ")}>{progressOf(lead)}</Badge></TableCell>
          <TableCell><Link href={`/dashboard/followups/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "size-7 p-0")} title={communicationLabel} aria-label={`${communicationLabel} · ${lead.provisionalStudentName}`}><ArrowRight className="size-3.5" /></Link></TableCell>
        </TableRow>
        <FollowupInlineDetails open={open} hideTitle pending={selection.assignmentPending} onOpenChange={(value) => changeDetails(lead.id, value)} title={`${lead.provisionalStudentName} · ${t("sourceDetails")}`} colSpan={colSpan} id={detailsId}>
          <FollowupEntryLayout data-lead-intake-details>
            <section data-followup-business className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <span className="flex items-center gap-2"><FollowupFieldIcon icon={MapPin} label={t("sourceDetails")} className="fill-moon text-crater" />{sourceAttribution}</span>
                {lead.interests.length ? <span className="flex items-center gap-2"><FollowupFieldIcon icon={HeartPulse} label={t("interests")} className="fill-cheek text-rose" />{lead.interests.join(" / ")}</span> : null}
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs @[32rem]/followup-entry:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]"><dt className="text-muted">{t("acquisitionLocation")}</dt><dd>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</dd><dt className="text-muted">{t("acquiredAt")}</dt><dd>{formatAt(lead.acquiredAt)}</dd></dl>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted"><span>{t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed")}{lead.sourceMarkedDuplicate ? ` · ${t("sourceDuplicate")}` : ""}</span>{canManageIdentity ? <div inert={selection.assignmentPending || undefined}><LeadIdentityControl lead={lead} /></div> : null}</div>
              {lead.suggestedStudentName ? <p className="text-xs text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p> : null}
              {lead.activeInvitation ? <p className="text-xs leading-5">{[invitationT(`kind_${lead.activeInvitation.kind}`), progressOf(lead), lead.activeInvitation.activityTitle, lead.activeInvitation.assessorName, lead.activeInvitation.locationText, lead.activeInvitation.scheduledAt ? formatAt(lead.activeInvitation.scheduledAt) : ""].filter(Boolean).join(" · ")}</p> : null}
            </section>
            <aside data-followup-notes className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="font-medium">{t("latestContact")}</span>{lead.lastContactOutcome ? <span>{t(`contactOutcome_${lead.lastContactOutcome}`)}</span> : null}<span className="text-[11px] text-muted">{lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted")}</span><span className="text-[11px] text-muted">{t("contactCount", { count: lead.contactCount })}</span></div>
              {lead.lastContactNote ? <p className="whitespace-pre-wrap break-words text-xs leading-5">{lead.lastContactNote}</p> : null}
              <div className="flex flex-wrap gap-2 text-[11px] text-muted">{lead.interestLevel ? <span>{t(`interest_${lead.interestLevel}`)}</span> : null}{lead.wechatAdded !== null ? <span>{t(lead.wechatAdded ? "wechatAdded" : "wechatNotAdded")}</span> : null}{lead.visitCommitted !== null ? <span>{t(lead.visitCommitted ? "visitCommitted" : "visitNotCommitted")}</span> : null}</div>
              {lead.nextContactAt ? <p className="text-xs text-muted">{invitationT("nextContactReminderScheduled", { time: formatAt(lead.nextContactAt) })}</p> : null}
              <Link href={`/dashboard/followups/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-7 px-0 text-xs")}>{communicationLabel}<ArrowRight className="size-3.5" /></Link>
            </aside>
          </FollowupEntryLayout>
        </FollowupInlineDetails>
      </Fragment>;
    })}{!table.visibleRows.length ? <TableRow><TableCell colSpan={colSpan} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
  </Table></DashboardTableShell>;
}
