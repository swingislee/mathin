"use client";

import { Check, ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FollowupEntryFields } from "./FollowupEntryFields";
import { FollowupContactFacts } from "./FollowupContactFacts";
import { FollowupPersonCell } from "./dashboard-page/FollowupPersonCell";
import { invitationForAdvance, invitationHasStageInformation, leadContactInput, leadWechatValue, type LeadContactDraft } from "./followup-entry-contract";
import { addStudentFollowUp } from "./actions/followups";
import { STUDENT_360_REFRESH_EVENT } from "./student-360-contract";
import { cn } from "@/lib/utils";
import { FollowupChoice, followupToneClasses } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { LeadIdentityControl } from "./LeadIdentityControl";
import { Student360Trigger } from "./Student360Sheet";
import { CONTACT_OUTCOME_SHORTCUTS, followupKeyboardCommand, followupKeyContext, navigateFollowupTable } from "./followup-keyboard";
import { useLeadPoolSelection } from "./LeadPoolSelection";
import {
  recordLeadContactAction,
  setLeadContactReminderAction,
  type LeadContactInput,
} from "./actions/leads";
import {
  DashboardTableColumnHeader,
  DashboardTableShell,
  type DashboardTableColumnDefinition,
  useDashboardTableView,
} from "./dashboard-page";
import {
  clearInvitationDraftSession,
  InvitationDraftFields,
  invitationDraftSessionKey,
} from "./InvitationDraftFields";
import {
  invitationDraftIsComplete,
  invitationCanHaveNextContactReminder,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
} from "./invitation-contract";
import {
  isFutureNextContactReminder,
} from "./NextContactReminderField";
import {
  deriveLeadContactDestination,
  type LeadContactOutcome,
  type LeadInterestLevel,
  type LeadPoolRow,
} from "./lead-contract";

const ACQUISITION_TIME_ZONE = "Asia/Shanghai";
const EMPTY_VALUE = "$empty";
type FirstContactTableColumn = "seed" | "context" | "owner" | "status";

type TernaryChoice = LeadContactDraft["wechatState"];

function leadCanHaveReminder(lead: LeadPoolRow): boolean {
  if (lead.activeInvitation) return invitationCanHaveNextContactReminder(lead.activeInvitation);
  return lead.status === "uncontacted" || lead.status === "nurture";
}

export function LeadContactEntryRow({
  lead,
  formatAt,
  active,
  selected = false,
  onActivate,
  onSaved,
  onReminderSaved,
  onAdvance,
  activities,
  assessors,
  locale,
  canContact,
  canAssign = false,
  canManageIdentity = false,
  visibleIds = [],
  layout = "default",
  expanded,
  onExpandedChange,
  onPendingChange,
  detailsExtra,
  rowActions,
  leadingSelection,
  workPurpose,
  detailsFirst = false,
  historicalSummary,
  historicalEntryLabel,
}: {
  lead: LeadPoolRow;
  formatAt: (value: string) => string;
  active: boolean;
  selected?: boolean;
  onActivate: (leadId: string) => void;
  onSaved: (leadId: string, input: LeadContactInput, advance?: boolean) => void;
  onAdvance?: () => void;
  onReminderSaved: (leadId: string, nextContactAt: string | null) => void;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  canContact: boolean;
  canAssign?: boolean;
  canManageIdentity?: boolean;
  visibleIds?: string[];
  layout?: "default" | "communication";
  expanded?: boolean;
  onExpandedChange?: (open: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  detailsExtra?: ReactNode;
  rowActions?: ReactNode;
  leadingSelection?: ReactNode;
  workPurpose?: ReactNode;
  detailsFirst?: boolean;
  historicalSummary?: { state: ReactNode; details: ReactNode; updated: ReactNode };
  historicalEntryLabel?: string;
}) {
  const t = useTranslations("school.leads");
  const invitationT = useTranslations("school.invitations");
  const entryT = useTranslations("school.followupEntry");
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [localDetailsOpen, setLocalDetailsOpen] = useState(false);
  const detailsOpen = expanded ?? localDetailsOpen;
  const setDetailsOpen = (open: boolean) => { setLocalDetailsOpen(open); onExpandedChange?.(open); };
  const detailsId = `lead-contact-details-${lead.id}`;
  const changeDetailsOpen = (open: boolean) => {
    if (!open && pending) return;
    setDetailsOpen(open);
    if (!open) rowRef.current?.focus({ preventScroll: true });
  };
  const canEdit = canContact && Boolean(lead.ownerId) && lead.status !== "invalid" && lead.status !== "converted";
  const canWriteNote = canContact && Boolean(lead.studentId);
  const canUseEntry = canEdit || canWriteNote;
  const submittedInputRef = useRef<LeadContactInput | null>(null);
  const [outcome, setOutcome] = useState<LeadContactOutcome | "">("");
  const [wechatState, setWechatState] = useState<TernaryChoice>("");
  const [interestLevel, setInterestLevel] = useState<LeadInterestLevel | "">("");
  const [invitation, setInvitation] = useState<InvitationDraft | null>(null);
  const [nextContactAt, setNextContactAt] = useState<string | null>(lead.nextContactAt);
  const advanceRef = useRef(false);
  const [note, setNote] = useState("");
  const draftStorageKey = invitationDraftSessionKey(
    "contact",
    lead.id,
    `${lead.contactCount}:${lead.lastContactAt ?? "new"}`,
  );

  useEffect(() => {
    if (!active || rowRef.current?.contains(document.activeElement) || document.getElementById(detailsId)?.contains(document.activeElement)) return;
    rowRef.current?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active, detailsId]);

  const contactRun = useAction(recordLeadContactAction, {
    successMessage: t("contactSaved"),
    errorMessage: {
      LEAD_UNASSIGNED: t("contactNeedsOwner"),
      LEAD_CLOSED: t("contactClosed"),
      REMINDER_NOT_FUTURE: invitationT("nextContactReminderPast"),
      REMINDER_NOT_ALLOWED: invitationT("nextContactReminderNotAllowed"),
      default: t("contactFailed"),
    },
    onSuccess: () => {
      const savedInput = submittedInputRef.current;
      submittedInputRef.current = null;
      // 本次未提交的业务草稿继续保留；只清空已经保存的输入。
      if (savedInput?.outcome === "connected") {
        clearInvitationDraftSession(draftStorageKey);
        setInvitation(null);
      }
      setOutcome("");
      if (savedInput?.outcome === "connected" || savedInput?.outcome === "declined") {
        setWechatState("");
        setInterestLevel("");
      }
      setNote("");
      setNextContactAt(savedInput?.nextContactAt ?? null);
      if (advanceRef.current) setDetailsOpen(false);
      if (savedInput) onSaved(lead.id, savedInput, advanceRef.current);
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      advanceRef.current = false;
    },
    onError: () => { submittedInputRef.current = null; },
  });

  const advanceFromRow = () => {
    setDetailsOpen(false);
    if (onAdvance) onAdvance();
    else {
      const nextId = visibleIds[visibleIds.indexOf(lead.id) + 1];
      if (nextId) onActivate(nextId);
    }
  };
  const submittedReminderRef = useRef<string | null>(null);
  const reminderRun = useAction(setLeadContactReminderAction, {
    successMessage: invitationT("nextContactReminderSaved"),
    errorMessage: { default: invitationT("nextContactReminderSaveFailed") },
    onSuccess: () => {
      onReminderSaved(lead.id, submittedReminderRef.current);
      if (advanceRef.current) advanceFromRow();
      advanceRef.current = false;
    },
  });
  // 有学生身份时，未选联系结果的文字沿用独立学生跟进，不伪造一次电话结果。
  const noteRun = useAction(addStudentFollowUp, {
    successMessage: t("contactSaved"),
    errorMessage: { default: t("contactFailed") },
    onSuccess: () => {
      setNote("");
      window.dispatchEvent(new Event(STUDENT_360_REFRESH_EVENT));
      if (advanceRef.current) advanceFromRow();
      advanceRef.current = false;
    },
  });
  const pending = contactRun.pending || reminderRun.pending || noteRun.pending;
  const pendingChangeRef = useRef(onPendingChange);
  useEffect(() => { pendingChangeRef.current = onPendingChange; }, [onPendingChange]);
  useEffect(() => { pendingChangeRef.current?.(pending); }, [pending]);
  useEffect(() => () => { pendingChangeRef.current?.(false); }, []);

  const reachable = outcome === "connected" || outcome === "declined";
  const canSubmit = outcome !== "connected" || !invitation || !invitationHasStageInformation(invitation) || invitationDraftIsComplete(invitation);
  const reminderAllowed = outcome === "unreachable" || outcome === "declined"
    || (outcome === "connected" && (!invitation || invitationCanHaveNextContactReminder(invitation)))
    || (!outcome && leadCanHaveReminder(lead));
  const draftReminderAt = outcome === "connected" && invitation ? invitation.nextContactAt : nextContactAt;
  const reminderValid = !reminderAllowed || isFutureNextContactReminder(draftReminderAt);
  const reminderDirty = !outcome && nextContactAt !== lead.nextContactAt;
  const noteOnly = !outcome && Boolean(lead.studentId) && Boolean(note.trim());
  const entryCanSave = (canEdit && canSubmit && reminderValid
    && (Boolean(outcome) || (reminderDirty && !note.trim())))
    || (canWriteNote && noteOnly && !reminderDirty);
  const hasDeferredFacts = Boolean(outcome && outcome !== "connected" && invitation)
    || Boolean(outcome && !reachable && (wechatState || interestLevel));
  const sourceAttribution = [
    lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "",
    lead.acquisitionMethod,
    lead.sourceCount > 1 ? t("sourceCount", { count: lead.sourceCount }) : "",
  ].filter(Boolean).join(" · ");
  const inputFor = (
    nextOutcome: LeadContactOutcome,
    invitationOverride: InvitationDraft | null = invitation,
  ): LeadContactInput => leadContactInput(nextOutcome, {
    note, wechatState, savedWechatAdded: lead.wechatAdded, interestLevel, invitation: invitationOverride, nextContactAt,
  });

  const submit = (
    nextOutcome: LeadContactOutcome | "" = outcome,
    invitationOverride: InvitationDraft | null = invitation,
    advance = false,
  ) => {
    if (!nextOutcome || !canEdit || pending) return;
    const arrangement = nextOutcome === "connected" && (advance || (nextContactAt && !invitationHasStageInformation(invitationOverride))) ? invitationForAdvance(invitationOverride, nextContactAt)
      : invitationOverride && !invitationHasStageInformation(invitationOverride) && invitationOverride.kind !== "waiting_activity" ? null : invitationOverride;
    const input = inputFor(nextOutcome, arrangement);
    if ((input.invitation && !invitationDraftIsComplete(input.invitation))
        || !isFutureNextContactReminder(input.nextContactAt)) return;
    advanceRef.current = advance;
    submittedInputRef.current = input;
    contactRun.run(lead.id, input);
  };

  const chooseOutcome = (nextOutcome: LeadContactOutcome) => {
    if (!canEdit || pending) return;
    onActivate(lead.id);
    setOutcome(nextOutcome);
    setDetailsOpen(true);
  };
  const saveEntry = (advance: boolean) => {
    if (!entryCanSave || pending) return;
    if (outcome) { submit(outcome, invitation, advance); return; }
    advanceRef.current = advance;
    if (noteOnly && lead.studentId) {
      noteRun.run(lead.studentId, { content: note.trim(), kind: "note", nextFollowUpAt: null, statusAfter: null });
    } else if (reminderDirty) {
      submittedReminderRef.current = nextContactAt;
      reminderRun.run(lead.id, nextContactAt);
    }
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const context = followupKeyContext(event);
    if (context.overlay || event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || pending) return;
    if (event.target === rowRef.current && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); changeDetailsOpen(!detailsOpen); return; }
    const command = followupKeyboardCommand({ ...event, isComposing: event.nativeEvent.isComposing }, context);
    if (command?.type === "close" && detailsOpen) { event.preventDefault(); changeDetailsOpen(false); return; }
    if (!canUseEntry) return;
    if (command?.type === "save") {
      event.preventDefault();
      saveEntry(false);
      return;
    }
    if (command?.type !== "outcome") return;
    event.preventDefault();
    chooseOutcome(command.outcome);
  };

  const contactFacts = reachable ? <FollowupContactFacts wechat={leadWechatValue(wechatState, lead.wechatAdded)}
    onWechatChange={(added) => setWechatState(added === null ? "unknown" : added ? "yes" : "no")} interest={interestLevel} onInterestChange={setInterestLevel} disabled={pending} /> : null;
  const entryCell = (
      <TableCell className="px-2 py-2">
        {historicalSummary ? <div className="mb-1 min-w-0">{historicalSummary.details}</div> : null}
        {historicalEntryLabel ? <p className="mb-1 text-[10px] text-muted">{historicalEntryLabel}</p> : null}
        {!historicalSummary ? <p className="mb-1 text-[11px] text-muted">{entryT("thisContact")}{outcome || note.trim() ? ` · ${entryT("unsaved")}` : ""}</p> : null}
        <div className="flex min-w-0 items-center gap-1">
          <FollowupChoice className="w-40 shrink-0" label={entryT("outcome")} value={outcome} disabled={!canEdit || pending}
            onValueChange={(value) => chooseOutcome(value as LeadContactOutcome)}
            options={CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome: value }) => ({ value, label: `${t(`contactOutcome_${value}`)} · ${key}`, tone: value === "connected" ? "healthy" : value === "invalid_number" ? "unhealthy" : "attention" }))} />
          {detailsOpen ? <span className="min-w-0 flex-1 truncate text-xs text-muted" title={note || undefined}>{note}</span> : <Input value={note} disabled={!canUseEntry || pending} maxLength={2000} className="h-8 w-0 min-w-0 flex-1 px-2 text-xs"
            onFocus={() => onActivate(lead.id)} onChange={(event) => setNote(event.target.value)} placeholder={entryT("note")} aria-label={t("contactNoteFor", { name: lead.provisionalStudentName })} />}
          <Button type="button" size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={pending} title={t("actions")} aria-label={t("actions")} aria-keyshortcuts="Enter" aria-expanded={detailsOpen} aria-controls={detailsId}
            onClick={() => changeDetailsOpen(!detailsOpen)}>{detailsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
          {!detailsOpen ? <Button type="button" size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={pending || !entryCanSave} onClick={() => saveEntry(false)} aria-label={entryT("save")} title={`${entryT("save")} · Ctrl ↵`} aria-keyshortcuts="Control+Enter Meta+Enter">
            {contactRun.pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </Button> : null}
          {canManageIdentity ? <span title={t("confirmIdentity")} className="shrink-0 [&>button]:size-7 [&>button]:gap-0 [&>button]:p-0 [&>button]:text-[0px]"><LeadIdentityControl lead={lead} /></span> : null}
        </div>
        {!historicalSummary ? <p className="mt-1 truncate text-[11px] text-muted" title={lead.lastContactNote}>{layout === "default" ? lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted") : ""}{lead.lastContactNote ? `${layout === "default" ? " · " : ""}${entryT("lastNote", { note: lead.lastContactNote })}` : ""}{lead.nextContactAt ? ` · ${formatAt(lead.nextContactAt)}` : ""}</p> : null}
      </TableCell>
  );

  return <>
    <TableRow data-communication-work-key={layout === "communication" ? `lead:${lead.id}` : undefined} data-followup-row-key={layout === "communication" ? `lead:${lead.id}` : lead.id} ref={rowRef} tabIndex={layout === "communication" || active ? 0 : -1} aria-selected={selected} data-followup-active={active} data-followup-expanded={detailsOpen} aria-busy={pending}
      className="h-16 focus-visible:outline-none [&>td]:min-w-0"
      onFocusCapture={() => onActivate(lead.id)}
      onClick={(event) => {
        onActivate(lead.id);
        if (!pending && !(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='option'],[role='checkbox']")) changeDetailsOpen(!detailsOpen);
      }} onKeyDown={handleRowKeyDown}>
      {layout === "communication" ? <>
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
        <FollowupPersonCell name={lead.provisionalStudentName} phone={lead.phone} owner={lead.ownerName || t("unassignedOwner")}
          grade={lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}
          subject={{ studentId: lead.studentId ?? null, leadId: lead.id }} studentGrade={lead.gradeHint}
          selection={leadingSelection} expanded={detailsOpen} detailsId={detailsId} onToggle={() => changeDetailsOpen(!detailsOpen)} />
      </TableCell>
      <TableCell className="px-2 py-2">{historicalSummary ? historicalSummary.state : <><Badge variant="outline" className={cn("max-w-full whitespace-normal rounded-md px-1.5 text-[11px]", followupToneClasses[lead.status === "invalid" ? "unhealthy" : lead.status === "nurture" ? "attention" : lead.status === "uncontacted" ? "neutral" : "healthy"])}><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />{lead.lastContactOutcome ? entryT("lastOutcome", { outcome: t(`contactOutcome_${lead.lastContactOutcome}`) }) : t(`status_${lead.status}`)}</Badge>{workPurpose ? <div className="mt-1 truncate text-[11px] text-muted">{workPurpose}</div> : <p className="mt-1 truncate text-[11px] text-muted" title={[lead.acquisitionLocation, sourceAttribution, ...lead.interests].filter(Boolean).join(" · ")}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}{lead.interests.length ? ` · ${lead.interests.join(" / ")}` : ""}</p>}</>}</TableCell>
      {entryCell}
      <TableCell className="px-2 py-2 text-[11px] text-muted">{historicalSummary ? historicalSummary.updated : <><span className="block break-words">{lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted")}</span>{lead.contactCount ? <p className="mt-1 truncate">{t("contactCount", { count: lead.contactCount })}</p> : null}</>}{rowActions ? <div className="mt-1 flex min-w-0 flex-wrap gap-1">{rowActions}</div> : null}</TableCell>
      </> : <>
      {canAssign && layout === "default" ? <LeadContactSelectionCell lead={lead} visibleIds={visibleIds} /> : null}
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
        <div className="flex min-w-0 items-baseline justify-between gap-2"><Student360Trigger subject={{ studentId: lead.studentId ?? null, leadId: lead.id }} fallback={{ name: lead.provisionalStudentName, phone: lead.phone, grade: lead.gradeHint, gradeText: lead.gradeText }} className="truncate">{lead.provisionalStudentName}</Student360Trigger>
          <span className="max-w-[50%] truncate text-[10px] text-muted" title={lead.gradeText || undefined}>{lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}</span></div>
        <div className="mt-1 flex min-w-0 items-center gap-2"><a className="shrink-0 font-mono text-[10px] hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a>{lead.sourceMarkedDuplicate ? <span className="truncate text-[10px] text-muted">{t("sourceDuplicateShort")}</span> : null}</div>
      </TableCell>
      <TableCell className="px-2 py-2"><p className="truncate" title={lead.acquisitionLocation}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}</p>
        <p className="mt-1 truncate text-[11px] text-muted" title={[sourceAttribution, ...lead.interests].join(" · ")}>{lead.acquiredAt ? formatAt(lead.acquiredAt) : "—"}{lead.interests.length ? ` · ${lead.interests.join(" / ")}` : ""}</p></TableCell>
      <TableCell className="px-2 py-2"><p className="truncate" title={lead.ownerName || t("unassignedOwner")}>{lead.ownerName || t("unassignedOwner")}</p></TableCell>
      <TableCell className="px-2 py-2"><Badge variant="outline" title={t(`status_${lead.status}`)} className={cn("max-w-full truncate px-1.5 text-[10px]", followupToneClasses[lead.status === "invalid" ? "unhealthy" : lead.status === "nurture" ? "attention" : ["contacted", "intent_confirmed", "converted"].includes(lead.status) ? "healthy" : "neutral"])}>{t(`status_${lead.status}`)}</Badge></TableCell>
      {entryCell}

      </>}
    </TableRow>
    <FollowupInlineDetails id={detailsId} open={detailsOpen} onOpenChange={changeDetailsOpen} title={lead.provisionalStudentName} hideTitle active={active} colSpan={layout === "communication" ? 4 : canAssign ? 6 : 5} pending={pending}
      onActivate={() => onActivate(lead.id)} onKeyDown={handleRowKeyDown}>
      {detailsFirst ? detailsExtra : null}
      {detailsFirst && historicalSummary ? <div className="space-y-1 text-xs text-muted">
        <p>{lead.lastContactOutcome ? t(`contactOutcome_${lead.lastContactOutcome}`) : t("notContacted")}{lead.lastContactAt ? ` · ${formatAt(lead.lastContactAt)}` : ""}</p>
        {lead.lastContactNote ? <p className="whitespace-pre-wrap">{lead.lastContactNote}</p> : null}
      </div> : null}
      <FollowupEntryFields id={detailsId} note={note} onNoteChange={setNote}
        disabled={!canUseEntry} pending={pending} saveDisabled={!entryCanSave} onSave={saveEntry}
        canAdvance={Boolean(onAdvance || visibleIds.length > 1)}
        placeholder={outcome ? t(`contactNotePlaceholder_${outcome}`) : undefined}
        reminder={reminderAllowed ? {
          value: draftReminderAt,
          disabled: !canEdit || noteOnly,
          onChange: (next) => outcome === "connected" && invitation
            ? setInvitation({ ...invitation, nextContactAt: next })
            : setNextContactAt(next),
        } : undefined}
        hint={!canUseEntry ? entryT("readOnly")
          : !outcome && note.trim() ? entryT(noteOnly && !reminderDirty ? "studentNoteOnly" : "chooseOutcome")
          : hasDeferredFacts ? entryT("deferredFacts") : outcome ? undefined : entryT(canWriteNote ? "studentNoteAvailable" : "chooseOutcome")}>
        {outcome === "connected" ? <InvitationDraftFields key={draftStorageKey} value={invitation} activities={activities} assessors={assessors} locale={locale}
          gradeHint={lead.gradeHint} contactFacts={contactFacts} enableProgressShortcuts={false} disabled={pending} showReminder={false} draftStorageKey={draftStorageKey}
          onChange={(value) => setInvitation(value && !invitation && invitationCanHaveNextContactReminder(value) ? { ...value, nextContactAt: value.nextContactAt ?? nextContactAt } : value)} /> : contactFacts}
      </FollowupEntryFields>
      {!detailsFirst ? detailsExtra : null}
    </FollowupInlineDetails>
  </>;
}

function LeadContactSelectionCell({ lead, visibleIds }: { lead: LeadPoolRow; visibleIds: string[] }) {
  const t = useTranslations("school.leads");
  const selection = useLeadPoolSelection();
  const rangeRef = useRef(false);
  return <TableCell className="w-8 px-2 py-2"><Checkbox checked={selection.selected.has(lead.id)}
    disabled={selection.assignmentPending || lead.status === "invalid" || lead.status === "converted"}
    onClick={(event) => { rangeRef.current = event.shiftKey; }}
    onCheckedChange={(checked) => { selection.toggleLead(lead.id, checked === true, visibleIds, rangeRef.current); rangeRef.current = false; }}
    aria-label={t("selectLead", { name: lead.provisionalStudentName })} /></TableCell>;
}

export function LeadFirstContactWorkbench({
  leads,
  locale,
  activities,
  assessors,
  canContact = false,
  canAssign = false,
  canManageIdentity = false,
  currentUserId,
}: {
  leads: LeadPoolRow[];
  locale: string;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  canContact?: boolean;
  canAssign?: boolean;
  canManageIdentity?: boolean;
  currentUserId?: string;
}) {
  const t = useTranslations("school.leads");
  const tableT = useTranslations("school.table");
  const [session, setSession] = useState({ source: leads, rows: leads });
  if (session.source !== leads) setSession({ source: leads, rows: leads });
  const sessionLeads = session.rows;
  const setSessionLeads = (update: (current: LeadPoolRow[]) => LeadPoolRow[]) => setSession((current) => ({ ...current, rows: update(current.rows) }));
  const [activeLeadId, setActiveLeadId] = useState<string | null>(() => leads[0]?.id ?? null);
  const selection = useLeadPoolSelection();
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));
  const tableColumns = useMemo<Record<FirstContactTableColumn, DashboardTableColumnDefinition<LeadPoolRow>>>(() => ({
    seed: {
      filterValues: (lead) => [
        { value: `name:${lead.provisionalStudentName}`, label: lead.provisionalStudentName, group: tableT("fieldName") },
        { value: `phone:${lead.phone}`, label: lead.phone, group: tableT("fieldPhone") },
        {
          value: lead.gradeText || lead.gradeHint ? `grade:${lead.gradeText || lead.gradeHint}` : `grade:${EMPTY_VALUE}`,
          label: lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade")),
          group: tableT("fieldGrade"),
        },
        ...(lead.contactCount > 0
          ? [{ value: `contacts:${lead.contactCount}`, label: String(lead.contactCount), group: tableT("fieldContactCount") }]
          : []),
        ...(lead.lastContactAt
          ? [{
              value: `contact-time:${lead.lastContactAt}`,
              label: dateTimeFormatter.format(new Date(lead.lastContactAt)),
              group: tableT("fieldTime"),
            }]
          : []),
        ...(lead.lastContactOutcome
          ? [{
              value: `contact-result:${lead.lastContactOutcome}`,
              label: t(`contactOutcome_${lead.lastContactOutcome}`),
              group: tableT("fieldContactResult"),
            }]
          : []),
      ],
      sortValue: (lead) => lead.provisionalStudentName,
    },
    owner: { filterValues: (lead) => ({ value: lead.ownerId ?? "$unassigned", label: lead.ownerName || t("unassignedOwner") }), sortValue: (lead) => lead.ownerName },
    status: { filterValues: (lead) => ({ value: lead.status, label: t(`status_${lead.status}`) }), sortValue: (lead) => lead.status },
    context: {
      filterValues: (lead) => [
        ...(lead.interests.length > 0
          ? lead.interests.map((interest) => ({ value: `interest:${interest}`, label: interest, group: tableT("fieldInterest") }))
          : [{ value: `interest:${EMPTY_VALUE}`, label: t("noSourceInterest"), group: tableT("fieldInterest") }]),
        {
          value: lead.acquisitionLocation ? `location:${lead.acquisitionLocation}` : "$missing-location",
          label: lead.acquisitionLocation || t("acquisitionLocationMissing"),
          group: tableT("fieldLocation"),
        },
        ...(lead.acquiredAt
          ? [{
              value: `acquired:${lead.acquiredAt}`,
              label: dateTimeFormatter.format(new Date(lead.acquiredAt)),
              group: tableT("fieldTime"),
            }]
          : []),
        ...(lead.acquisitionPromoter
          ? [{
              value: `promoter:${lead.acquisitionPromoter}`,
              label: t("promoterValue", { name: lead.acquisitionPromoter }),
              group: tableT("fieldPromoter"),
            }]
          : []),
        ...(lead.acquisitionMethod
          ? [{ value: `method:${lead.acquisitionMethod}`, label: lead.acquisitionMethod, group: tableT("fieldMethod") }]
          : []),
        ...(lead.sourceCount > 1
          ? [{
              value: `source-count:${lead.sourceCount}`,
              label: t("sourceCount", { count: lead.sourceCount }),
              group: tableT("fieldSourceCount"),
            }]
          : []),
      ],
      sortValue: (lead) => lead.acquiredAt,
    },
  }), [dateTimeFormatter, t, tableT]);
  const contactTable = useDashboardTableView({ rows: sessionLeads, columns: tableColumns, locale, persistenceKey: `school.followup.leads.${currentUserId ?? "user"}` });
  const visibleIds = contactTable.visibleRows.filter((lead) => lead.status !== "invalid" && lead.status !== "converted").map((lead) => lead.id);
  const selectedVisibleCount = visibleIds.filter((id) => selection.selected.has(id)).length;

  const resolvedActiveLeadId = activeLeadId && contactTable.visibleRows.some((lead) => lead.id === activeLeadId)
    ? activeLeadId
    : null;

  const recordAndAdvance = (leadId: string, input: LeadContactInput, advance = false) => {
    const currentIndex = contactTable.visibleRows.findIndex((lead) => lead.id === leadId);
    if (currentIndex < 0 || contactTable.visibleRows.length === 0) {
      setActiveLeadId(null);
      return;
    }
    const nextLead = [
      ...contactTable.visibleRows.slice(currentIndex + 1),
      ...contactTable.visibleRows.slice(0, currentIndex),
    ].find((lead) => lead.status === "uncontacted");
    if (advance) setActiveLeadId(nextLead?.id ?? null);

    const savedAt = new Date().toISOString();
    const destination = deriveLeadContactDestination(input.outcome);
    setSessionLeads((current) => current.map((lead) => lead.id === leadId
      ? {
          ...lead,
          status: destination,
          contactCount: lead.contactCount + 1,
          lastContactAt: savedAt,
          lastContactOutcome: input.outcome,
          lastContactNote: input.note,
          wechatAdded: input.outcome === "connected" || input.outcome === "declined" ? input.wechatAdded : lead.wechatAdded,
          interestLevel: input.interestLevel ?? lead.interestLevel,
          nextContactAt: input.nextContactAt,
          activeInvitation: input.invitation ? {
            id: lead.activeInvitation?.id ?? `session-${lead.id}`,
            ...input.invitation,
            legacyTimeText: "",
            activityTitle: input.invitation.activityId
              ? activities.find((activity) => activity.id === input.invitation?.activityId)?.title ?? ""
              : "",
            activityScheduledAt: input.invitation.activityId
              ? activities.find((activity) => activity.id === input.invitation?.activityId)?.scheduledAt ?? null
              : null,
            assessorName: input.invitation.assessorId
              ? assessors.find((assessor) => assessor.userId === input.invitation?.assessorId)?.displayName ?? ""
              : "",
            updatedAt: savedAt,
            nextContactAt: input.invitation.nextContactAt ?? input.nextContactAt ?? null,
          } : lead.activeInvitation,
        }
      : lead));
  };

  const updateSessionReminder = (leadId: string, nextContactAt: string | null) => {
    setSessionLeads((current) => current.map((lead) => lead.id === leadId
      ? {
          ...lead,
          nextContactAt,
          activeInvitation: lead.activeInvitation
            ? { ...lead.activeInvitation, nextContactAt }
            : null,
        }
      : lead));
  };

  return (
      <DashboardTableShell data-followup-workbench>
        <Table className="w-full min-w-[52rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <colgroup>{canAssign ? <col style={{ width: "2rem" }} /> : null}<col style={{ width: "19%" }} /><col style={{ width: "15%" }} /><col style={{ width: "9%" }} /><col style={{ width: "11%" }} /><col /></colgroup>
          <TableHeader>
            <TableRow>
              {canAssign ? <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><Checkbox checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length ? true : selectedVisibleCount > 0 ? "indeterminate" : false} disabled={!visibleIds.length || selection.assignmentPending} onCheckedChange={(checked) => selection.setVisibleSelection(visibleIds, checked === true)} aria-label={t("selectPage")} /></TableHead> : null}
              <TableHead className="sticky left-0 top-0 z-30 h-8 bg-card px-2"><DashboardTableColumnHeader label={t("seed")} {...contactTable.columnProps("seed")} /></TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2"><DashboardTableColumnHeader label={t("firstContactContext")} {...contactTable.columnProps("context")} /></TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2"><DashboardTableColumnHeader label={t("owner")} {...contactTable.columnProps("owner")} /></TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2"><DashboardTableColumnHeader label={t("status")} {...contactTable.columnProps("status")} /></TableHead>
              <TableHead className="sticky top-0 z-20 h-8 bg-card px-2">{t("firstContactEntry")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody onKeyDown={(event) => navigateFollowupTable(event, (key) => { setActiveLeadId(key); return true; })}>
            {contactTable.visibleRows.map((lead) => (
              <LeadContactEntryRow
                key={lead.id}
                lead={lead}
                formatAt={formatAt}
                active={lead.id === resolvedActiveLeadId}
                selected={selection.selected.has(lead.id)}
                onActivate={setActiveLeadId}
                onSaved={recordAndAdvance}
                onReminderSaved={updateSessionReminder}
                activities={activities}
                assessors={assessors}
                locale={locale}
                canContact={canContact}
                canAssign={canAssign}
                canManageIdentity={canManageIdentity}
                visibleIds={visibleIds}
              />
            ))}
            {contactTable.visibleRows.length === 0 ? (
              <TableRow><TableCell colSpan={canAssign ? 6 : 5} className="h-32 px-4 text-center text-sm text-muted">{tableT("filteredEmpty")}</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </DashboardTableShell>
  );
}
