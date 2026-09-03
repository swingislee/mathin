"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { recordLeadContactAction, type LeadContactInput } from "./actions/leads";
import { DashboardTableShell } from "./dashboard-page";
import { InvitationDraftFields } from "./InvitationDraftFields";
import {
  invitationDraftIsComplete,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
} from "./invitation-contract";
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

type TernaryChoice = "" | "yes" | "no";

function DirectChoiceGroup<T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  choices: ReadonlyArray<{ value: T; label: string; accessibleLabel?: string }>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="mr-1 text-[11px] text-muted" aria-hidden="true">{label}</span>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <Button
            key={choice.value || "unset"}
            type="button"
            size="sm"
            variant="secondary"
            className={cn(
              "h-7 px-2.5 text-[11px]",
              selected && "border-leaf-deep bg-leaf/60 text-ink hover:bg-leaf/70",
            )}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={choice.accessibleLabel ?? choice.label}
            onClick={() => onChange(choice.value)}
          >
            {selected ? <Check className="size-3" /> : null}
            {choice.label}
          </Button>
        );
      })}
    </div>
  );
}

function ContactEntryRow({
  lead,
  formatAt,
  active,
  onActivate,
  onSaved,
  activities,
  assessors,
  locale,
}: {
  lead: LeadPoolRow;
  formatAt: (value: string) => string;
  active: boolean;
  onActivate: (leadId: string) => void;
  onSaved: (leadId: string, input: LeadContactInput) => void;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
}) {
  const t = useTranslations("school.leads");
  const rowRef = useRef<HTMLTableRowElement>(null);
  const submittedInputRef = useRef<LeadContactInput | null>(null);
  const [outcome, setOutcome] = useState<LeadContactOutcome | "">("");
  const [wechatState, setWechatState] = useState<TernaryChoice>("");
  const [interestLevel, setInterestLevel] = useState<LeadInterestLevel | "">("");
  const [invitation, setInvitation] = useState<InvitationDraft | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!active) return;
    rowRef.current?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const reset = () => {
    setOutcome("");
    setWechatState("");
    setInterestLevel("");
    setInvitation(null);
    setNote("");
  };
  const contactRun = useAction(recordLeadContactAction, {
    successMessage: t("contactSaved"),
    errorMessage: {
      LEAD_UNASSIGNED: t("contactNeedsOwner"),
      LEAD_CLOSED: t("contactClosed"),
      default: t("contactFailed"),
    },
    onSuccess: () => {
      const savedInput = submittedInputRef.current;
      submittedInputRef.current = null;
      reset();
      if (savedInput) onSaved(lead.id, savedInput);
    },
    onError: () => { submittedInputRef.current = null; },
  });

  const reachable = outcome === "connected" || outcome === "declined";
  const destination = outcome
    ? deriveLeadContactDestination(outcome)
    : null;
  const canSubmit = !invitation || invitationDraftIsComplete(invitation);
  const displayedOutcome = outcome || lead.lastContactOutcome;
  const savedReachable = lead.lastContactOutcome === "connected" || lead.lastContactOutcome === "declined";
  const showSavedDetails = Boolean(lead.lastContactOutcome && (savedReachable || lead.lastContactNote));
  const savedWechatFact = lead.wechatAdded === true
    ? t("wechatAddedShort")
    : lead.wechatAdded === false
      ? t("wechatNotAdded")
      : t("notDiscussed");
  const savedInterest = lead.interestLevel
    ? t(`interest_${lead.interestLevel}`)
    : t("interestUnrated");
  const sourceAttribution = [
    lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "",
    lead.acquisitionMethod,
    lead.sourceCount > 1 ? t("sourceCount", { count: lead.sourceCount }) : "",
  ].filter(Boolean).join(" · ");

  const inputFor = (nextOutcome: LeadContactOutcome): LeadContactInput => {
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
      invitation: nextOutcome === "connected" ? invitation : null,
    };
  };

  const submit = (nextOutcome: LeadContactOutcome | "" = outcome) => {
    if (!nextOutcome) return;
    const input = inputFor(nextOutcome);
    if (input.invitation && !invitationDraftIsComplete(input.invitation)) return;
    submittedInputRef.current = input;
    contactRun.run(lead.id, input);
  };

  const chooseOutcome = (nextOutcome: LeadContactOutcome) => {
    onActivate(lead.id);
    setOutcome(nextOutcome);
    if (nextOutcome === "unreachable" || nextOutcome === "invalid_number") {
      setWechatState("");
      setInterestLevel("");
      setInvitation(null);
    } else if (nextOutcome === "declined") {
      setInvitation(null);
    }
    if (QUICK_SUBMIT_OUTCOMES.includes(nextOutcome)) submit(nextOutcome);
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (!active || contactRun.pending || event.repeat || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && outcome) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input, [contenteditable='true']")) return;
    const shortcut = CONTACT_OUTCOME_SHORTCUTS.find((item) => item.key === event.key);
    if (!shortcut) return;
    event.preventDefault();
    chooseOutcome(shortcut.outcome);
  };

  const wechatChoices: ReadonlyArray<{ value: TernaryChoice; label: string }> = [
    { value: "", label: t("notDiscussed") },
    { value: "yes", label: t("wechatAddedShort") },
    { value: "no", label: t("wechatNotAdded") },
  ];
  const interestChoices: ReadonlyArray<{
    value: LeadInterestLevel | "";
    label: string;
    accessibleLabel?: string;
  }> = [
    { value: "", label: t("interestUnrated") },
    ...(["A", "B", "C"] as const).map((value) => ({
      value,
      label: value,
      accessibleLabel: t(`interest_${value}`),
    })),
  ];

  return (
    <TableRow
      ref={rowRef}
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-busy={contactRun.pending}
      className={cn(
        "focus-visible:outline-none",
        active && "bg-moon/10 hover:bg-moon/10",
      )}
      onClick={() => onActivate(lead.id)}
      onKeyDown={handleRowKeyDown}
    >
      <TableCell
        className="sticky left-0 z-10 min-w-56 border-r border-line bg-card px-2 py-2 align-top"
        style={active
          ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" }
          : undefined}
      >
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-medium text-ink">{lead.provisionalStudentName}</span>
          <a className="font-mono text-[11px] text-ink underline-offset-4 hover:underline" href={`tel:${lead.phone}`}>
            {lead.phone}
          </a>
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          {lead.gradeText || (lead.gradeHint ? t("gradeValue", { grade: lead.gradeHint }) : t("unknownGrade"))}
        </p>
        {lead.contactCount > 0 && lead.lastContactAt ? (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] leading-4 text-muted">
            <span>{t("firstContactTried", { count: lead.contactCount, time: formatAt(lead.lastContactAt) })}</span>
            {lead.lastContactOutcome ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal leading-4">
                {t(`contactOutcome_${lead.lastContactOutcome}`)}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </TableCell>

      <TableCell className="min-w-60 max-w-80 px-2 py-2 align-top">
        <p className="truncate text-xs text-ink" title={lead.acquisitionLocation || undefined}>
          {lead.acquisitionLocation || t("acquisitionLocationMissing")}
        </p>
        <p className="mt-0.5 truncate text-[11px] leading-4 text-muted" title={sourceAttribution || undefined}>
          {lead.acquiredAt ? formatAt(lead.acquiredAt) : t("acquisitionTimeMissing")}
          {sourceAttribution ? ` · ${sourceAttribution}` : ""}
        </p>
        <div className="mt-1 flex max-w-80 flex-wrap gap-1">
          {lead.interests.length > 0
            ? lead.interests.map((interest) => (
                <Badge key={interest} variant="outline" className="px-1.5 py-0 text-[11px] font-normal leading-4">
                  {interest}
                </Badge>
              ))
            : <span className="text-[11px] text-muted">{t("noSourceInterest")}</span>}
        </div>
      </TableCell>

      <TableCell className="min-w-[38rem] px-2 py-2 align-top">
        <div className="flex items-start gap-2">
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome: value }) => {
              const selected = displayedOutcome === value;
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={selected ? "primary" : "secondary"}
                  className={cn(
                    "h-8 px-3 text-xs",
                    selected && "shadow-sm",
                  )}
                  disabled={contactRun.pending}
                  aria-pressed={selected}
                  onClick={() => chooseOutcome(value)}
                >
                  {contactRun.pending && selected
                    ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                    : selected
                      ? <Check className="size-3.5" />
                      : <span className="font-mono text-[11px] text-muted">{key}</span>}
                  {t(`contactOutcome_${value}`)}
                </Button>
              );
            })}
          </div>
          <Textarea
            value={note}
            disabled={contactRun.pending}
            onFocus={() => onActivate(lead.id)}
            onChange={(event) => setNote(event.target.value)}
            rows={1}
            maxLength={2000}
            className="h-8 min-h-8 min-w-52 flex-1 resize-y overflow-hidden rounded-xl px-2 py-1.5 text-xs transition-[height] focus:h-20 focus:overflow-auto motion-reduce:transition-none"
            placeholder={outcome ? t(`contactNotePlaceholder_${outcome}`) : t("contactNoteInlinePlaceholder")}
            aria-label={t("contactNoteFor", { name: lead.provisionalStudentName })}
          />
        </div>

        {showSavedDetails ? (
          <div
            className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
            aria-label={t("latestContact")}
          >
            {savedReachable ? (
              <>
                <div className="flex items-center gap-1 text-[11px] text-muted">
                  <span>{t("wechatFact")}</span>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal leading-4 text-ink">
                    {savedWechatFact}
                  </Badge>
                </div>
                {lead.activeInvitation ? (
                  <div className="flex items-center gap-1 text-[11px] text-muted">
                    <span>{t("invitationFact")}</span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal leading-4 text-ink">
                      {t(`invitationKind_${lead.activeInvitation.kind}`)} · {t(`invitationState_${lead.activeInvitation.state}`)}
                    </Badge>
                  </div>
                ) : null}
                <div className="flex items-center gap-1 text-[11px] text-muted">
                  <span>{t("interestLevel")}</span>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal leading-4 text-ink">
                    {savedInterest}
                  </Badge>
                </div>
              </>
            ) : null}
            <p
              className={cn(
                "min-w-52 flex-1 text-[11px] leading-4 text-ink",
                active ? "whitespace-pre-wrap break-words" : "truncate",
              )}
              title={active ? undefined : lead.lastContactNote || undefined}
            >
              <span className="text-muted">{t("contactNote")} · </span>
              {lead.lastContactNote || t("noContactNote")}
            </p>
          </div>
        ) : null}

        {active && outcome ? (
          <div className="mt-2 space-y-2 border-t border-line pt-2">
            {reachable ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                <DirectChoiceGroup
                  label={t("wechatFact")}
                  value={wechatState}
                  choices={wechatChoices}
                  disabled={contactRun.pending}
                  onChange={setWechatState}
                />
                <DirectChoiceGroup
                  label={t("interestLevel")}
                  value={interestLevel}
                  choices={interestChoices}
                  disabled={contactRun.pending}
                  onChange={setInterestLevel}
                />
              </div>
            ) : null}

            {outcome === "connected" ? (
              <InvitationDraftFields
                value={invitation}
                activities={activities}
                assessors={assessors}
                locale={locale}
                disabled={contactRun.pending}
                onChange={setInvitation}
              />
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] leading-4 text-muted" aria-live="polite">
                {destination
                  ? invitation
                    ? t("contactDestinationWithInvitation", {
                        status: t(`status_${destination}`),
                        queue: t(`invitationState_${invitation.state}`),
                      })
                    : t("contactDestination", { status: t(`status_${destination}`) })
                  : t("contactDestinationPending")}
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 whitespace-nowrap"
                disabled={contactRun.pending || !canSubmit}
                onClick={() => submit()}
              >
                {contactRun.pending
                  ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                  : <Check className="size-4" />}
                {t("saveContactRow")}
              </Button>
            </div>
          </div>
        ) : outcome ? (
          <p className="mt-2 text-[11px] text-muted">{t("contactDraftPending")}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function LeadFirstContactWorkbench({
  leads,
  locale,
  activities,
  assessors,
}: {
  leads: LeadPoolRow[];
  locale: string;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
}) {
  const t = useTranslations("school.leads");
  const [sessionLeads, setSessionLeads] = useState(leads);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(() => leads[0]?.id ?? null);
  const freshCount = sessionLeads.filter((lead) => lead.status === "uncontacted" && lead.contactCount === 0).length;
  const retryCount = sessionLeads.filter((lead) => lead.status === "uncontacted" && lead.contactCount > 0).length;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));

  const resolvedActiveLeadId = activeLeadId && sessionLeads.some((lead) => lead.id === activeLeadId)
    ? activeLeadId
    : null;

  const recordAndAdvance = (leadId: string, input: LeadContactInput) => {
    const currentIndex = sessionLeads.findIndex((lead) => lead.id === leadId);
    if (currentIndex < 0 || sessionLeads.length === 0) {
      setActiveLeadId(null);
      return;
    }
    const nextLead = [
      ...sessionLeads.slice(currentIndex + 1),
      ...sessionLeads.slice(0, currentIndex),
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
          activeInvitation: input.invitation ? {
            id: lead.activeInvitation?.id ?? `session-${lead.id}`,
            ...input.invitation,
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
          } : lead.activeInvitation,
        }
      : lead));
  };

  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{t("firstContactWorkbenchHint")}</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-normal leading-4">
          {t("firstContactFreshCount", { count: freshCount })}
        </Badge>
        {retryCount > 0 ? (
          <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal leading-4">
            {t("firstContactRetryCount", { count: retryCount })}
          </Badge>
        ) : null}
      </div>

      <DashboardTableShell>
        <Table className="w-full min-w-[67rem] text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-30 h-8 min-w-56 bg-card px-2">{t("seed")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-60 bg-card px-2">{t("firstContactContext")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-[38rem] bg-card px-2">{t("firstContactEntry")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessionLeads.map((lead) => (
              <ContactEntryRow
                key={lead.id}
                lead={lead}
                formatAt={formatAt}
                active={lead.id === resolvedActiveLeadId}
                onActivate={setActiveLeadId}
                onSaved={recordAndAdvance}
                activities={activities}
                assessors={assessors}
                locale={locale}
              />
            ))}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </div>
  );
}
