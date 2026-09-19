"use client";

import { FollowupTableRecord, type FollowupRowState } from "./dashboard-page/FollowupTableRecord";

import { useCallback, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, Copy, HeartPulse, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SchoolSupportTableEntry, SchoolSupportInsertion } from "./SchoolSupportInlineEntry";
import { SchoolSupportPendingRows } from './SchoolSupportPendingRows';
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import { useDashboardFieldView } from "./dashboard-page/useDashboardFieldView";
import { formatDashboardDate } from "./dashboard-page/dashboard-table-date-contract";
import { LEAD_INTAKE_TABLE_COLUMNS, leadIntakeTableFields } from "./lead-intake-table-fields";
import { useFollowupServerFields } from "./useFollowupServerFields";
import type { FollowupServerFields } from "./followup-table-page";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { followupToneClasses, type FollowupTone } from "./dashboard-page/FollowupChoice";
import { LeadIdentityControl } from "./LeadIdentityControl";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import { FollowupEntryLayout } from "./FollowupEntryFields";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import { followupFocusActivatesRow, followupKeyContext, navigateFollowupTable } from "./followup-keyboard";
import { Student360Trigger } from "./Student360Sheet";
import { PossibleDuplicateBadge } from "./PossibleDuplicateBadge";
import type { LeadPoolRow } from "./lead-contract";

export function LeadIntakeWorkbench({ leads, locale, canAssign = false, canManageIdentity = false, canAdd = false, currentUserId, fieldView, timeZone = "Asia/Shanghai", now }: {
  leads: LeadPoolRow[];
  locale: string;
  canAdd?: boolean;
  canAssign?: boolean;
  canManageIdentity?: boolean;
  currentUserId?: string;
  fieldView?: FollowupServerFields;
  timeZone?: string;
  now?: number;
}) {
  const t = useTranslations("school.leads");
  const tableT = useTranslations("school.table");
  const invitationT = useTranslations("school.invitations");
  const selection = useLeadPoolSelection();
  const rangeRef = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [clockNow] = useState(() => now ?? Date.now());
  const context = useMemo(() => ({ locale, timeZone, now: clockNow }), [locale, timeZone, clockNow]);
  const formatAt = useCallback((value: string | null, dateOnly = false) => formatDashboardDate(value, context, { time: !dateOnly }), [context]);
  const gradeOf = useCallback((lead: LeadPoolRow) => lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade")), [t]);
  const progressOf = useCallback((lead: LeadPoolRow) => lead.activeInvitation ? invitationT(`state_${lead.activeInvitation.state}`) : t(`status_${lead.status}`), [invitationT, t]);
  const toneOf = useCallback((lead: LeadPoolRow): FollowupTone => lead.activeInvitation
    ? ["confirmed", "completed"].includes(lead.activeInvitation.state) ? "healthy" : lead.activeInvitation.state === "cancelled" ? "unhealthy" : "attention"
    : lead.status === "invalid" ? "unhealthy" : lead.status === "nurture" ? "attention" : ["contacted", "intent_confirmed", "converted"].includes(lead.status) ? "healthy" : "neutral", []);
  const fields = useMemo(() => leadIntakeTableFields(t, tableT, invitationT), [t, tableT, invitationT]);
  const server = useFollowupServerFields(fieldView);
  const table = useDashboardFieldView({ rows: leads, fields, columns: LEAD_INTAKE_TABLE_COLUMNS, context, server,
    persistenceKey: server ? undefined : `school.followup.lead-intake.fields-v2.${currentUserId ?? "user"}` });
  const visibleIds = useMemo(() => table.visibleRows.filter((lead) => !["invalid", "converted"].includes(lead.status)).map((lead) => lead.id), [table.visibleRows]);
  const visibleKey = visibleIds.join(",");
  const { setVisibleIds } = selection;
  // 命令栏明确显示被列筛选隐藏的已选项，分配范围始终可核对。
  useEffect(() => { setVisibleIds(visibleKey ? visibleKey.split(",") : []); }, [setVisibleIds, visibleKey]);
  const selectedCount = visibleIds.filter((id) => selection.selected.has(id)).length;
  const changeDetails = useCallback((id: string, open: boolean) => {
    if (selection.assignmentPending) return;
    setActiveId(id);
    setExpandedId(open ? id : null);
    if (!open) rowRefs.current.get(id)?.focus({ preventScroll: true });
  }, [selection.assignmentPending]);
  const colSpan = canAssign ? 9 : 8;
  const renderRow = useCallback((lead: LeadPoolRow, state: FollowupRowState) => {
    const { active, expanded: open } = state;
    const detailsId = `lead-source-${lead.id}`;
    const sourceAttribution = [lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "", lead.acquisitionMethod, t("sourceCount", { count: lead.sourceCount })].filter(Boolean).join(" · ");
    const communicationLabel = t(lead.contactCount || lead.activeInvitation ? "continueCommunication" : "openCommunication");
    return <Fragment key={lead.id}>
      <TableRow ref={(node) => { if (node) rowRefs.current.set(lead.id, node); else rowRefs.current.delete(lead.id); }}
        data-lead-intake-row={lead.id} data-followup-row-key={lead.id} data-followup-active={active || open} data-followup-expanded={open}
        tabIndex={0} aria-expanded={open} aria-controls={detailsId} aria-selected={canAssign ? selection.selected.has(lead.id) : undefined} aria-busy={selection.assignmentPending}
        className="h-9 cursor-pointer [&>td]:min-w-0 [&>td]:whitespace-nowrap [&>td]:px-2 [&>td]:py-1 [&:focus-visible_[data-lead-details-trigger]]:outline-2 [&:focus-visible_[data-lead-details-trigger]]:outline-crater"
        onFocus={(event) => { if (followupFocusActivatesRow(event)) setActiveId(lead.id); }}
        onClick={(event) => { setActiveId(lead.id); if (!(event.target as HTMLElement).closest("button,a,input,select,textarea,[role='checkbox']")) changeDetails(lead.id, !open); }}
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
          <PossibleDuplicateBadge count={lead.possibleDuplicateCount} subject={{ studentId: lead.studentId ?? null, leadId: lead.id }} name={lead.provisionalStudentName} locale={locale} />
        </TableCell>
        <TableCell><a className="font-mono text-[11px] hover:underline" href={`tel:${lead.phone}`}>{lead.phone || "—"}</a></TableCell>
        <TableCell className="truncate text-muted" title={gradeOf(lead)}>{gradeOf(lead)}</TableCell>
        <TableCell className="truncate" title={[lead.acquisitionLocation, sourceAttribution, lead.interests.join(" / ")].filter(Boolean).join(" · ")}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</TableCell>
        <TableCell className="tabular-nums text-muted" title={lead.acquiredAt ? formatAt(lead.acquiredAt) : lead.acquiredDateLabel}>{lead.acquiredAt ? formatAt(lead.acquiredAt, true) : lead.acquiredDateLabel || formatAt(null, true)}</TableCell>
        <TableCell className="truncate" title={lead.ownerName}>{lead.ownerName || t("unassignedOwner")}</TableCell>
        <TableCell><Badge variant="outline" className={cn("max-w-full truncate px-1.5 py-0 text-[11px] leading-5", followupToneClasses[toneOf(lead)])} title={[progressOf(lead), lead.activeInvitation ? invitationT(`kind_${lead.activeInvitation.kind}`) : "", lead.lastContactNote].filter(Boolean).join(" · ")}>{progressOf(lead)}</Badge></TableCell>
        <TableCell><Link href={`/dashboard/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "size-7 p-0")} title={communicationLabel} aria-label={`${communicationLabel} · ${lead.provisionalStudentName}`}><ArrowRight className="size-3.5" /></Link></TableCell>
      </TableRow>
      <FollowupInlineDetails open={open} hideTitle pending={selection.assignmentPending} onOpenChange={(value) => changeDetails(lead.id, value)} title={`${lead.provisionalStudentName} · ${t("sourceDetails")}`} colSpan={colSpan} id={detailsId}>
        {() => <FollowupEntryLayout data-lead-intake-details>
          <section data-followup-business className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <span className="flex items-center gap-2"><FollowupFieldIcon icon={MapPin} label={t("sourceDetails")} className="fill-moon text-crater" />{sourceAttribution}</span>
              {lead.interests.length ? <span className="flex items-center gap-2"><FollowupFieldIcon icon={HeartPulse} label={t("interests")} className="fill-cheek text-rose" />{lead.interests.join(" / ")}</span> : null}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs @[32rem]/followup-entry:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]"><dt className="text-muted">{t("acquisitionLocation")}</dt><dd>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</dd><dt className="text-muted">{t("acquiredAt")}</dt><dd>{lead.acquiredAt ? formatAt(lead.acquiredAt) : lead.acquiredDateLabel || formatAt(null)}</dd></dl>
            {lead.baseAcquisitionSources?.map(source => <section key={source.sourceId} className="space-y-1 text-xs">
              <p className="text-muted">Base{source.dateLabel ? ` · ${source.dateLabel}` : ""}{source.location ? ` · ${source.location}` : ""}{source.method ? ` · ${source.method}` : ""}{source.promoter ? ` · ${source.promoter}` : ""}</p>
              {source.group ? <p>{t("acquisitionGroup")}：{source.group}</p> : null}
              {source.content ? <p className="whitespace-pre-wrap break-words leading-5">{t("acquisitionContent")}：{source.content}</p> : null}
            </section>)}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted"><span>{t(lead.status === "converted" ? "identityConfirmed" : "identityUnconfirmed")}{lead.sourceMarkedDuplicate ? ` · ${t("sourceDuplicate")}` : ""}</span>{canManageIdentity ? <div inert={selection.assignmentPending || undefined}><LeadIdentityControl lead={lead} /></div> : null}</div>
            {lead.suggestedStudentName ? <p className="text-xs text-muted">{t("studentSuggestion", { name: lead.suggestedStudentName })}</p> : null}
            {lead.activeInvitation ? <p className="text-xs leading-5">{[invitationT(`kind_${lead.activeInvitation.kind}`), progressOf(lead), lead.activeInvitation.activityTitle, lead.activeInvitation.assessorName, lead.activeInvitation.locationText, lead.activeInvitation.scheduledAt ? formatAt(lead.activeInvitation.scheduledAt) : ""].filter(Boolean).join(" · ")}</p> : null}
          </section>
          <aside data-followup-notes className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span className="font-medium">{t("latestContact")}</span>{lead.lastContactOutcome ? <span>{t(`contactOutcome_${lead.lastContactOutcome}`)}</span> : null}<span className="text-[11px] text-muted">{lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted")}</span><span className="text-[11px] text-muted">{t("contactCount", { count: lead.contactCount })}</span></div>
            {lead.lastContactNote ? <p className="whitespace-pre-wrap break-words text-xs leading-5">{lead.lastContactNote}</p> : null}
            <div className="flex flex-wrap gap-2 text-[11px] text-muted">{lead.interestLevel ? <span>{t(`interest_${lead.interestLevel}`)}</span> : null}{lead.wechatAdded !== null ? <span>{t(lead.wechatAdded ? "wechatAdded" : "wechatNotAdded")}</span> : null}{lead.visitCommitted !== null ? <span>{t(lead.visitCommitted ? "visitCommitted" : "visitNotCommitted")}</span> : null}</div>
            {lead.nextContactAt ? <p className="text-xs text-muted">{invitationT("nextContactReminderScheduled", { time: formatAt(lead.nextContactAt) })}</p> : null}
            <Link href={`/dashboard/communication?lead=${lead.id}`} className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "h-7 px-0 text-xs")}>{communicationLabel}<ArrowRight className="size-3.5" /></Link>
          </aside>
        </FollowupEntryLayout>}
      </FollowupInlineDetails>
    </Fragment>;
  }, [canAssign, canManageIdentity, changeDetails, colSpan, formatAt, gradeOf, invitationT, locale, progressOf, selection, t, toneOf, visibleIds]);

  return <SchoolSupportTableEntry workspace="leads" enabled={canAdd} columns={[...(canAssign ? ["blank" as const] : []),"name","phone","grade","blank","blank","blank","blank","blank"]}><DashboardTableShell data-lead-intake-workbench data-followup-workbench data-followup-scroll>
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
      <TableHead className={cn("sticky top-0 z-30 border-r border-line bg-card", canAssign ? "left-8" : "left-0")}><DashboardTableColumnHeader label={tableT("fieldName")} {...table.columnProps("identity")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={tableT("fieldPhone")} {...table.columnProps("phone")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("grade")} {...table.columnProps("grade")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("acquisitionLocation")} {...table.columnProps("source")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("acquiredAt")} {...table.columnProps("acquiredAt")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("owner")} {...table.columnProps("owner")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><DashboardTableColumnHeader label={t("intakeProgress")} {...table.columnProps("progress")} /></TableHead>
      <TableHead className="sticky top-0 z-20 bg-card"><span className="sr-only">{t("actions")}</span></TableHead>
    </TableRow></TableHeader>
    <TableBody><SchoolSupportInsertion after="start" /><SchoolSupportPendingRows workspace="leads" colSpan={colSpan} />{table.visibleRows.map((lead) => <FollowupTableRecord key={lead.id} row={lead} active={activeId === lead.id} expanded={expandedId === lead.id} render={renderRow} />)}{!table.visibleRows.length ? <TableRow><TableCell colSpan={colSpan} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
  </Table></DashboardTableShell></SchoolSupportTableEntry>;
}
