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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FollowupChoice, followupToneClasses } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { LeadIdentityControl } from "./LeadIdentityControl";
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
  invitationWorkStep,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
} from "./invitation-contract";
import {
  isFutureNextContactReminder,
  NextContactReminderField,
} from "./NextContactReminderField";
import {
  deriveLeadContactDestination,
  type LeadContactOutcome,
  type LeadInterestLevel,
  type LeadPoolRow,
} from "./lead-contract";

const CONTACT_OUTCOME_SHORTCUTS = [
  { key: "1", outcome: "unreachable" },
  { key: "2", outcome: "connected" },
  { key: "3", outcome: "declined" },
  { key: "4", outcome: "invalid_number" },
] as const satisfies ReadonlyArray<{ key: string; outcome: LeadContactOutcome }>;
const QUICK_SUBMIT_OUTCOMES: readonly LeadContactOutcome[] = ["unreachable", "invalid_number"];
const ACQUISITION_TIME_ZONE = "Asia/Shanghai";
const EMPTY_VALUE = "$empty";
type FirstContactTableColumn = "seed" | "context" | "owner" | "status";

type TernaryChoice = "" | "yes" | "no";

function leadCanHaveReminder(lead: LeadPoolRow): boolean {
  if (lead.activeInvitation) return invitationCanHaveNextContactReminder(lead.activeInvitation);
  return lead.status === "uncontacted" || lead.status === "nurture";
}

function SavedLeadReminderControl({
  lead,
  disabled,
  onSaved,
}: {
  lead: LeadPoolRow;
  disabled: boolean;
  onSaved: (leadId: string, nextContactAt: string | null) => void;
}) {
  const t = useTranslations("school.invitations");
  const submittedRef = useRef<string | null>(lead.nextContactAt);
  const [nextContactAt, setNextContactAt] = useState<string | null>(lead.nextContactAt);
  const reminderRun = useAction(setLeadContactReminderAction, {
    successMessage: t("nextContactReminderSaved"),
    errorMessage: {
      REMINDER_NOT_FUTURE: t("nextContactReminderPast"),
      REMINDER_NOT_ALLOWED: t("nextContactReminderNotAllowed"),
      default: t("nextContactReminderSaveFailed"),
    },
    onSuccess: () => onSaved(lead.id, submittedRef.current),
  });
  const valid = isFutureNextContactReminder(nextContactAt);
  const dirty = nextContactAt !== lead.nextContactAt;

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
      <NextContactReminderField
        id={`saved-lead-reminder-${lead.id}`}
        value={nextContactAt}
        disabled={disabled || reminderRun.pending}
        className="min-w-0 basis-56 flex-1"
        onChange={setNextContactAt}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mb-5 h-auto min-h-8 max-w-full whitespace-normal px-2 py-1 text-xs"
        disabled={disabled || reminderRun.pending || !dirty || !valid}
        onClick={() => {
          submittedRef.current = nextContactAt;
          reminderRun.run(lead.id, nextContactAt);
        }}
      >
        {reminderRun.pending
          ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
          : <Check className="size-3.5" />}
        {t("saveNextContactReminder")}
      </Button>
    </div>
  );
}

export function LeadContactEntryRow({
  lead,
  formatAt,
  active,
  onActivate,
  onSaved,
  onReminderSaved,
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
  onActivate: (leadId: string) => void;
  onSaved: (leadId: string, input: LeadContactInput) => void;
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
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [localDetailsOpen, setLocalDetailsOpen] = useState(false);
  const detailsOpen = expanded ?? localDetailsOpen;
  const setDetailsOpen = (open: boolean) => { setLocalDetailsOpen(open); onExpandedChange?.(open); };
  const detailsId = `lead-contact-details-${lead.id}`;
  const changeDetailsOpen = (open: boolean) => {
    if (!open && contactRun.pending) return;
    setDetailsOpen(open);
    if (!open) rowRef.current?.focus({ preventScroll: true });
  };
  const canEdit = canContact && Boolean(lead.ownerId) && lead.status !== "invalid" && lead.status !== "converted";
  const submittedInputRef = useRef<LeadContactInput | null>(null);
  const [outcome, setOutcome] = useState<LeadContactOutcome | "">("");
  const [wechatState, setWechatState] = useState<TernaryChoice>("");
  const [interestLevel, setInterestLevel] = useState<LeadInterestLevel | "">("");
  const [invitation, setInvitation] = useState<InvitationDraft | null>(null);
  const [nextContactAt, setNextContactAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const draftStorageKey = invitationDraftSessionKey(
    "contact",
    lead.id,
    `${lead.contactCount}:${lead.lastContactAt ?? "new"}`,
  );

  useEffect(() => {
    if (!active || rowRef.current?.contains(document.activeElement)) return;
    rowRef.current?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const reset = () => {
    setOutcome("");
    setWechatState("");
    setInterestLevel("");
    setInvitation(null);
    setNextContactAt(null);
    setNote("");
  };
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
      clearInvitationDraftSession(draftStorageKey);
      reset();
      setDetailsOpen(false);
      if (savedInput) onSaved(lead.id, savedInput);
    },
    onError: () => { submittedInputRef.current = null; },
  });

  const pendingChangeRef = useRef(onPendingChange);
  useEffect(() => { pendingChangeRef.current = onPendingChange; }, [onPendingChange]);
  useEffect(() => { pendingChangeRef.current?.(contactRun.pending); }, [contactRun.pending]);
  useEffect(() => () => { pendingChangeRef.current?.(false); }, []);

  const reachable = outcome === "connected" || outcome === "declined";
  const canSubmit = !invitation || invitationDraftIsComplete(invitation);
  const draftReminderAt = outcome === "declined"
    ? nextContactAt
    : invitation && invitationCanHaveNextContactReminder(invitation)
      ? invitation.nextContactAt ?? null
      : null;
  const reminderValid = isFutureNextContactReminder(draftReminderAt);
  const displayedOutcome = outcome || lead.lastContactOutcome;
  const sourceAttribution = [
    lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "",
    lead.acquisitionMethod,
    lead.sourceCount > 1 ? t("sourceCount", { count: lead.sourceCount }) : "",
  ].filter(Boolean).join(" · ");
  const invitationStepLabel = (draft: InvitationDraft) => {
    const step = invitationWorkStep(draft);
    return step === "closed" ? invitationT(`state_${draft.state}`) : invitationT(`workTitle_${step}`);
  };

  const inputFor = (
    nextOutcome: LeadContactOutcome,
    invitationOverride: InvitationDraft | null = invitation,
  ): LeadContactInput => {
    const nextReachable = nextOutcome === "connected" || nextOutcome === "declined";
    return {
      outcome: nextOutcome,
      note,
      wechatAdded: nextReachable
        ? wechatState === "yes"
          ? true
          : wechatState === "no"
            ? false
            : null
        : null,
      interestLevel: nextReachable && interestLevel ? interestLevel : null,
      invitation: nextOutcome === "connected" ? invitationOverride : null,
      nextContactAt: nextOutcome === "declined"
        ? nextContactAt
        : nextOutcome === "connected"
          && invitationOverride
          && invitationCanHaveNextContactReminder(invitationOverride)
            ? invitationOverride.nextContactAt ?? null
            : null,
    };
  };

  const submit = (
    nextOutcome: LeadContactOutcome | "" = outcome,
    invitationOverride: InvitationDraft | null = invitation,
  ) => {
    if (!nextOutcome || !canEdit) return;
    const input = inputFor(nextOutcome, invitationOverride);
    if ((input.invitation && !invitationDraftIsComplete(input.invitation))
        || !isFutureNextContactReminder(input.nextContactAt)) return;
    submittedInputRef.current = input;
    contactRun.run(lead.id, input);
  };

  const chooseOutcome = (nextOutcome: LeadContactOutcome) => {
    if (!canEdit) return;
    onActivate(lead.id);
    setOutcome(nextOutcome);
    if (!QUICK_SUBMIT_OUTCOMES.includes(nextOutcome)) setDetailsOpen(true);
    if (nextOutcome === "unreachable" || nextOutcome === "invalid_number") {
      setWechatState("");
      setInterestLevel("");
      setInvitation(null);
      setNextContactAt(null);
    } else if (nextOutcome === "declined") {
      setInvitation(null);
    }
    if (QUICK_SUBMIT_OUTCOMES.includes(nextOutcome)) {
      const input = {
        ...inputFor(nextOutcome, null),
        nextContactAt: null,
      };
      submittedInputRef.current = input;
      contactRun.run(lead.id, input);
    }
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || contactRun.pending) return;
    if (event.target === rowRef.current && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); changeDetailsOpen(!detailsOpen); return; }
    if (event.key === "Escape" && detailsOpen) { event.preventDefault(); changeDetailsOpen(false); return; }
    if (!canEdit || !active || contactRun.pending || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && outcome) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, [role='combobox'], [role='option'], [contenteditable='true']")) return;
    const shortcut = CONTACT_OUTCOME_SHORTCUTS.find((item) => item.key === event.key);
    if (!shortcut) return;
    event.preventDefault();
    chooseOutcome(shortcut.outcome);
  };

  const wechatChoices = [
    { value: "", label: t("notDiscussed"), tone: "neutral" as const },
    { value: "yes", label: t("wechatAddedShort"), tone: "healthy" as const },
    { value: "no", label: t("wechatNotAdded"), tone: "attention" as const },
  ];
  const interestChoices = [
    { value: "", label: t("interestUnrated"), tone: "neutral" as const },
    { value: "A", label: t("interest_A"), tone: "healthy" as const },
    { value: "B", label: t("interest_B"), tone: "attention" as const },
    { value: "C", label: t("interest_C"), tone: "unhealthy" as const },
  ];
  const confirmableInvitation = invitation?.state === "awaiting_parent"
    && invitationDraftIsComplete({ ...invitation, state: "confirmed" })
    ? { ...invitation, state: "confirmed" as const, nextContactAt: null }
    : null;
  const directConfirmedInvitation = invitation?.state === "confirmed"
    && invitationDraftIsComplete(invitation);

  const entryCell = (
      <TableCell className="px-2 py-2">
        {historicalSummary ? <div className="mb-1 min-w-0">{historicalSummary.details}</div> : null}
        {historicalEntryLabel ? <p className="mb-1 text-[10px] text-muted">{historicalEntryLabel}</p> : null}
        <div className="flex min-w-0 items-center gap-1">
          <FollowupChoice className="w-28 shrink-0" label={t("latestContact")} value={displayedOutcome ?? ""} disabled={!canEdit || contactRun.pending}
            onValueChange={(value) => chooseOutcome(value as LeadContactOutcome)}
            options={CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome: value }) => ({ value, label: `${t(`contactOutcome_${value}`)} · ${key}`, tone: value === "connected" ? "healthy" : value === "invalid_number" ? "unhealthy" : "attention" }))} />
          <Input value={note} disabled={!canEdit || contactRun.pending} maxLength={2000} className="h-8 w-0 min-w-0 flex-1 px-2 text-xs"
            onFocus={() => onActivate(lead.id)} onChange={(event) => setNote(event.target.value)} placeholder={t("contactNoteInlinePlaceholder")} aria-label={t("contactNoteFor", { name: lead.provisionalStudentName })} />
          <Button type="button" size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={contactRun.pending} title={t("actions")} aria-label={t("actions")} aria-keyshortcuts="Enter" aria-expanded={detailsOpen} aria-controls={detailsId}
            onClick={() => changeDetailsOpen(!detailsOpen)}>{detailsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button>
          <Button type="button" size="sm" variant="ghost" className="size-7 shrink-0 p-0" disabled={!canEdit || !outcome || contactRun.pending || !canSubmit || !reminderValid} onClick={() => submit()} aria-label={t("saveContactRow")} title={`${t("saveContactRow")} · Ctrl ↵`} aria-keyshortcuts="Control+Enter Meta+Enter">
            {contactRun.pending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          </Button>
          {canManageIdentity ? <span title={t("confirmIdentity")} className="shrink-0 [&>button]:size-7 [&>button]:gap-0 [&>button]:p-0 [&>button]:text-[0px]"><LeadIdentityControl lead={lead} /></span> : null}
        </div>
        {!historicalSummary ? <p className="mt-1 truncate text-[11px] text-muted" title={lead.lastContactNote}>{layout === "default" ? lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted") : ""}{lead.lastContactNote ? `${layout === "default" ? " · " : ""}${lead.lastContactNote}` : ""}{lead.nextContactAt ? ` · ${formatAt(lead.nextContactAt)}` : ""}</p> : null}
      </TableCell>
  );

  return <>
    <TableRow data-communication-work-key={layout === "communication" ? `lead:${lead.id}` : undefined} ref={rowRef} tabIndex={layout === "communication" || active ? 0 : -1} aria-selected={active} aria-busy={contactRun.pending}
      className={cn("h-16 focus-visible:outline-none [&>td]:min-w-0", active && "bg-blue/5")}
      onClick={(event) => {
        onActivate(lead.id);
        if (!contactRun.pending && !(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='option'],[role='checkbox']")) changeDetailsOpen(!detailsOpen);
      }} onKeyDown={handleRowKeyDown}>
      {layout === "communication" ? <>
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
        <div className="flex min-w-0 items-center gap-1">{leadingSelection}<Button type="button" size="sm" variant="ghost" className="size-5 shrink-0 p-0" aria-expanded={detailsOpen} aria-controls={detailsId} aria-label={lead.provisionalStudentName} onClick={() => changeDetailsOpen(!detailsOpen)}>{detailsOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</Button><span className="truncate font-medium" title={lead.provisionalStudentName}>{lead.provisionalStudentName}</span></div>
        <p className="mt-0.5 truncate pl-6 text-[11px] text-muted">{lead.ownerName || t("unassignedOwner")} · {lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}</p>
        <a className="mt-0.5 block truncate pl-6 font-mono text-[10px] hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a>
      </TableCell>
      <TableCell className="px-2 py-2">{historicalSummary ? historicalSummary.state : <><Badge variant="outline" className={cn("max-w-full truncate px-1.5 text-[10px]", followupToneClasses[lead.status === "invalid" ? "unhealthy" : lead.status === "nurture" ? "attention" : lead.status === "uncontacted" ? "neutral" : "healthy"])}>{lead.lastContactOutcome ? t(`contactOutcome_${lead.lastContactOutcome}`) : t(`status_${lead.status}`)}</Badge>{workPurpose ? <div className="mt-1 truncate text-[11px] text-muted">{workPurpose}</div> : <p className="mt-1 truncate text-[11px] text-muted" title={[lead.acquisitionLocation, sourceAttribution, ...lead.interests].filter(Boolean).join(" · ")}>{lead.acquisitionLocation || t("acquisitionLocationMissing")}{lead.interests.length ? ` · ${lead.interests.join(" / ")}` : ""}</p>}</>}</TableCell>
      {entryCell}
      <TableCell className="px-2 py-2 text-[11px] text-muted">{historicalSummary ? historicalSummary.updated : <><span className="block break-words">{lead.lastContactAt ? formatAt(lead.lastContactAt) : t("notContacted")}</span>{lead.contactCount ? <p className="mt-1 truncate">{t("contactCount", { count: lead.contactCount })}</p> : null}</>}{rowActions ? <div className="mt-1 flex min-w-0 flex-wrap gap-1">{rowActions}</div> : null}</TableCell>
      </> : <>
      {canAssign && layout === "default" ? <LeadContactSelectionCell lead={lead} visibleIds={visibleIds} /> : null}
      <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2">
        <div className="flex min-w-0 items-baseline justify-between gap-2"><span className="min-w-0 truncate font-medium text-ink" title={lead.provisionalStudentName}>{lead.provisionalStudentName}</span>
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
    <FollowupInlineDetails id={detailsId} open={detailsOpen} onOpenChange={changeDetailsOpen} title={lead.provisionalStudentName} colSpan={layout === "communication" ? 4 : canAssign ? 6 : 5} pending={contactRun.pending}>
      {detailsFirst ? detailsExtra : null}
      <div className="grid min-w-0 gap-4 @5xl/followup-entry:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" onKeyDown={handleRowKeyDown}>
        <section className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canEdit ? <FollowupChoice className="w-36" label={t("latestContact")} value={displayedOutcome ?? ""} disabled={contactRun.pending}
              onValueChange={(value) => chooseOutcome(value as LeadContactOutcome)} options={CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome: value }) => ({ value, label: `${t(`contactOutcome_${value}`)} · ${key}`, tone: value === "connected" ? "healthy" : value === "invalid_number" ? "unhealthy" : "attention" }))} /> : null}
            {reachable ? <>
              <FollowupChoice label={t("wechatFact")} value={wechatState} options={wechatChoices} disabled={contactRun.pending} onValueChange={(value) => setWechatState(value as TernaryChoice)} />
              <FollowupChoice className="w-36" label={t("interestLevel")} value={interestLevel} options={interestChoices} disabled={contactRun.pending} onValueChange={(value) => setInterestLevel(value as LeadInterestLevel | "")} />
            </> : null}
          </div>
          {outcome === "connected" ? <InvitationDraftFields value={invitation} activities={activities} assessors={assessors} locale={locale} disabled={contactRun.pending} draftStorageKey={draftStorageKey} onChange={setInvitation} /> : null}
          {outcome === "declined" ? <NextContactReminderField id={`lead-next-contact-${lead.id}`} value={nextContactAt} disabled={contactRun.pending} onChange={setNextContactAt} /> : null}
          {!outcome && lead.lastContactOutcome ? <div className="space-y-2 text-xs"><p>{t(`contactOutcome_${lead.lastContactOutcome}`)} · {lead.lastContactAt ? formatAt(lead.lastContactAt) : ""}</p>
            {lead.activeInvitation ? <p>{t(`invitationKind_${lead.activeInvitation.kind}`)} · {invitationStepLabel(lead.activeInvitation)}</p> : null}</div> : null}
          {!outcome && canEdit && leadCanHaveReminder(lead) ? <SavedLeadReminderControl lead={lead} disabled={contactRun.pending} onSaved={onReminderSaved} /> : null}
        </section>
        <section className="min-w-0 space-y-3 @5xl/followup-entry:border-l @5xl/followup-entry:border-line @5xl/followup-entry:pl-4">
          {outcome ? <>
            <Textarea className="min-w-0 text-xs" value={note} disabled={contactRun.pending} rows={3} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder={t(`contactNotePlaceholder_${outcome}`)} aria-label={t("contactNote")} />
            <div className="flex min-w-0 flex-wrap justify-end gap-2">
              {confirmableInvitation ? <Button type="button" size="sm" variant="secondary" className="h-auto min-h-8 max-w-full whitespace-normal px-2 py-1 text-xs" disabled={contactRun.pending} onClick={() => submit("connected", confirmableInvitation)}>{t("saveContactAndConfirmInvitation")}</Button> : null}
              <Button type="button" size="sm" className="h-auto min-h-8 max-w-full whitespace-normal px-2 py-1 text-xs" disabled={contactRun.pending || !canSubmit || !reminderValid} onClick={() => submit()} aria-keyshortcuts="Control+Enter Meta+Enter">
                {contactRun.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}{directConfirmedInvitation ? t("saveContactConfirmedInvitation") : t("saveContactRow")}<kbd className="ml-1 shrink-0 whitespace-nowrap text-[10px]">Ctrl ↵</kbd>
              </Button>
            </div>
          </> : <p className="whitespace-pre-wrap text-xs">{lead.lastContactNote || t("noContactNote")}</p>}
          <p className="break-words text-[11px] text-muted">{[sourceAttribution, ...lead.interests].filter(Boolean).join(" · ")}</p>
        </section>
      </div>
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

  const recordAndAdvance = (leadId: string, input: LeadContactInput) => {
    const currentIndex = contactTable.visibleRows.findIndex((lead) => lead.id === leadId);
    if (currentIndex < 0 || contactTable.visibleRows.length === 0) {
      setActiveLeadId(null);
      return;
    }
    const nextLead = [
      ...contactTable.visibleRows.slice(currentIndex + 1),
      ...contactTable.visibleRows.slice(0, currentIndex),
    ].find((lead) => lead.status === "uncontacted");
    setActiveLeadId(nextLead?.id ?? null);

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
          wechatAdded: input.wechatAdded,
          interestLevel: input.interestLevel,
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
      <DashboardTableShell>
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
          <TableBody>
            {contactTable.visibleRows.map((lead) => (
              <LeadContactEntryRow
                key={lead.id}
                lead={lead}
                formatAt={formatAt}
                active={lead.id === resolvedActiveLeadId}
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
