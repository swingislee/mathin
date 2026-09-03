"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { recordLeadContactAction, type LeadContactInput } from "./actions/leads";
import { DashboardTableShell } from "./dashboard-page";
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
              selected && "border-ink bg-moon/60 text-ink hover:bg-moon/70",
            )}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={choice.accessibleLabel ?? choice.label}
            onClick={() => onChange(choice.value)}
          >
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
}: {
  lead: LeadPoolRow;
  formatAt: (value: string) => string;
  active: boolean;
  onActivate: (leadId: string) => void;
  onSaved: (leadId: string) => void;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [outcome, setOutcome] = useState<LeadContactOutcome | "">("");
  const [wechatState, setWechatState] = useState<TernaryChoice>("");
  const [visitState, setVisitState] = useState<TernaryChoice>("");
  const [interestLevel, setInterestLevel] = useState<LeadInterestLevel | "">("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!active) return;
    rowRef.current?.focus({ preventScroll: true });
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const reset = () => {
    setOutcome("");
    setWechatState("");
    setVisitState("");
    setInterestLevel("");
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
      reset();
      onSaved(lead.id);
      router.refresh();
    },
  });

  const reachable = outcome === "connected" || outcome === "declined";
  const visitCommitted = outcome === "connected" && visitState === "yes";
  const destination = outcome
    ? deriveLeadContactDestination(outcome, visitCommitted)
    : null;
  const sourceAttribution = [
    lead.acquisitionPromoter ? t("promoterValue", { name: lead.acquisitionPromoter }) : "",
    lead.acquisitionMethod,
    lead.sourceCount > 1 ? t("sourceCount", { count: lead.sourceCount }) : "",
  ].filter(Boolean).join(" · ");

  const inputFor = (nextOutcome: LeadContactOutcome): LeadContactInput => {
    const nextReachable = nextOutcome === "connected" || nextOutcome === "declined";
    return {
      outcome: nextOutcome,
      note: nextReachable ? note : "",
      wechatAdded: nextReachable
        ? wechatState === "yes"
          ? true
          : wechatState === "no"
            ? false
            : null
        : null,
      visitCommitted: nextOutcome === "connected"
        ? visitState === "yes"
          ? true
          : visitState === "no"
            ? false
            : null
        : null,
      interestLevel: nextReachable && interestLevel ? interestLevel : null,
    };
  };

  const submit = (nextOutcome: LeadContactOutcome | "" = outcome) => {
    if (!nextOutcome) return;
    contactRun.run(lead.id, inputFor(nextOutcome));
  };

  const chooseOutcome = (nextOutcome: LeadContactOutcome) => {
    onActivate(lead.id);
    setOutcome(nextOutcome);
    if (nextOutcome === "unreachable" || nextOutcome === "invalid_number") {
      setWechatState("");
      setVisitState("");
      setInterestLevel("");
      setNote("");
    } else if (nextOutcome === "declined") {
      setVisitState("");
    }
    if (QUICK_SUBMIT_OUTCOMES.includes(nextOutcome)) submit(nextOutcome);
  };

  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (!active || contactRun.pending || event.repeat || event.altKey) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && reachable) {
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
  const visitChoices: ReadonlyArray<{ value: TernaryChoice; label: string }> = [
    { value: "", label: t("notDiscussed") },
    { value: "yes", label: t("visitCommittedShort") },
    { value: "no", label: t("visitNotCommitted") },
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
      <TableCell className={cn(
        "sticky left-0 z-10 min-w-64 px-2 py-2 align-top",
        active ? "bg-moon/10" : "bg-card",
      )}>
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
          <p className="mt-1 text-[11px] leading-4 text-muted">
            {t("firstContactTried", { count: lead.contactCount, time: formatAt(lead.lastContactAt) })}
          </p>
        ) : null}
      </TableCell>

      <TableCell className="min-w-72 max-w-96 px-2 py-2 align-top">
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

      <TableCell className="min-w-[46rem] px-2 py-2 align-top">
        <div className="flex flex-wrap gap-1.5">
          {CONTACT_OUTCOME_SHORTCUTS.map(({ key, outcome: value }) => {
            const selected = outcome === value;
            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="secondary"
                className={cn(
                  "h-8 px-3 text-xs",
                  selected && "border-ink bg-moon/60 text-ink hover:bg-moon/70",
                )}
                disabled={contactRun.pending}
                aria-pressed={selected}
                onClick={() => chooseOutcome(value)}
              >
                {contactRun.pending && selected
                  ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                  : <span className="font-mono text-[11px] text-muted">{key}</span>}
                {t(`contactOutcome_${value}`)}
              </Button>
            );
          })}
        </div>

        {active && reachable ? (
          <div className="mt-2 space-y-2 border-t border-line pt-2">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <DirectChoiceGroup
                label={t("wechatFact")}
                value={wechatState}
                choices={wechatChoices}
                disabled={contactRun.pending}
                onChange={setWechatState}
              />
              {outcome === "connected" ? (
                <DirectChoiceGroup
                  label={t("visitFact")}
                  value={visitState}
                  choices={visitChoices}
                  disabled={contactRun.pending}
                  onChange={setVisitState}
                />
              ) : null}
              <DirectChoiceGroup
                label={t("interestLevel")}
                value={interestLevel}
                choices={interestChoices}
                disabled={contactRun.pending}
                onChange={setInterestLevel}
              />
            </div>

            <Textarea
              value={note}
              disabled={contactRun.pending}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={2000}
              className="min-h-14 w-full resize-y rounded-xl px-2 py-1.5 text-xs"
              placeholder={t("contactNotePlaceholder")}
              aria-label={t("contactNoteFor", { name: lead.provisionalStudentName })}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] leading-4 text-muted" aria-live="polite">
                {destination
                  ? t("contactDestination", { status: t(`status_${destination}`) })
                  : t("contactDestinationPending")}
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 whitespace-nowrap"
                disabled={contactRun.pending}
                onClick={() => submit()}
              >
                {contactRun.pending
                  ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                  : <Check className="size-4" />}
                {t("saveContactRow")}
              </Button>
            </div>
          </div>
        ) : !active && reachable ? (
          <p className="mt-2 text-[11px] text-muted">{t("contactDraftPending")}</p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export function LeadFirstContactWorkbench({
  leads,
  locale,
}: {
  leads: LeadPoolRow[];
  locale: string;
}) {
  const t = useTranslations("school.leads");
  const [activeLeadId, setActiveLeadId] = useState<string | null>(() => leads[0]?.id ?? null);
  const freshCount = leads.filter((lead) => lead.contactCount === 0).length;
  const retryCount = leads.length - freshCount;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));

  const resolvedActiveLeadId = activeLeadId && leads.some((lead) => lead.id === activeLeadId)
    ? activeLeadId
    : leads[0]?.id ?? null;

  const advanceAfter = (leadId: string) => {
    const currentIndex = leads.findIndex((lead) => lead.id === leadId);
    if (currentIndex < 0 || leads.length === 0) {
      setActiveLeadId(leads[0]?.id ?? null);
      return;
    }
    setActiveLeadId(leads[currentIndex + 1]?.id ?? leads[0]?.id ?? null);
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
        <Table className="w-full min-w-[76rem] text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-30 h-8 min-w-64 bg-card px-2">{t("seed")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-72 bg-card px-2">{t("firstContactContext")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-[46rem] bg-card px-2">{t("firstContactEntry")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <ContactEntryRow
                key={lead.id}
                lead={lead}
                formatAt={formatAt}
                active={lead.id === resolvedActiveLeadId}
                onActivate={setActiveLeadId}
                onSaved={advanceAfter}
              />
            ))}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </div>
  );
}
