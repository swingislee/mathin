"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { recordLeadContactAction, type LeadContactInput } from "./actions/leads";
import { fromSelectValue, toSelectValue } from "./controls";
import { DashboardTableShell } from "./dashboard-page";
import {
  deriveLeadContactDestination,
  type LeadContactOutcome,
  type LeadInterestLevel,
  type LeadPoolRow,
} from "./lead-contract";

const CONTACT_OUTCOMES = ["unreachable", "connected", "declined", "invalid_number"] as const;
const ACQUISITION_TIME_ZONE = "Asia/Shanghai";

type TernaryChoice = "" | "yes" | "no";

function ContactEntryRow({
  lead,
  formatAt,
}: {
  lead: LeadPoolRow;
  formatAt: (value: string) => string;
}) {
  const t = useTranslations("school.leads");
  const router = useRouter();
  const [outcome, setOutcome] = useState<LeadContactOutcome | "">("");
  const [wechatState, setWechatState] = useState<TernaryChoice>("");
  const [visitState, setVisitState] = useState<TernaryChoice>("");
  const [interestLevel, setInterestLevel] = useState<LeadInterestLevel | "">("");
  const [note, setNote] = useState("");

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

  const submit = () => {
    if (!outcome) return;
    const input: LeadContactInput = {
      outcome,
      note,
      wechatAdded: reachable
        ? wechatState === "yes"
          ? true
          : wechatState === "no"
            ? false
            : null
        : null,
      visitCommitted: outcome === "connected"
        ? visitState === "yes"
          ? true
          : visitState === "no"
            ? false
            : null
        : null,
      interestLevel: reachable && interestLevel ? interestLevel : null,
    };
    contactRun.run(lead.id, input);
  };

  return (
    <TableRow aria-busy={contactRun.pending}>
      <TableCell className="sticky left-0 z-10 min-w-64 bg-card px-2 py-2 align-top">
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

      <TableCell className="min-w-40 px-2 py-2 align-top">
        <Select
          value={outcome || undefined}
          disabled={contactRun.pending}
          onValueChange={(value) => {
            const next = value as LeadContactOutcome;
            setOutcome(next);
            if (next === "unreachable" || next === "invalid_number") {
              setWechatState("");
              setVisitState("");
              setInterestLevel("");
            } else if (next === "declined") {
              setVisitState("");
            }
          }}
        >
          <SelectTrigger className="h-8 min-w-36 rounded-full bg-card px-2 text-xs" aria-label={t("contactOutcomeFor", { name: lead.provisionalStudentName })}>
            <SelectValue placeholder={t("contactOutcomePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {CONTACT_OUTCOMES.map((value) => (
              <SelectItem key={value} value={value}>{t(`contactOutcome_${value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell className="min-w-36 px-2 py-2 align-top">
        <Select
          value={toSelectValue(wechatState)}
          disabled={!reachable || contactRun.pending}
          onValueChange={(value) => setWechatState(fromSelectValue(value) as TernaryChoice)}
        >
          <SelectTrigger className="h-8 min-w-32 rounded-full bg-card px-2 text-xs" aria-label={t("wechatFactFor", { name: lead.provisionalStudentName })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("notDiscussed")}</SelectItem>
            <SelectItem value="yes">{t("wechatAdded")}</SelectItem>
            <SelectItem value="no">{t("wechatNotAdded")}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell className="min-w-36 px-2 py-2 align-top">
        <Select
          value={toSelectValue(visitState)}
          disabled={outcome !== "connected" || contactRun.pending}
          onValueChange={(value) => setVisitState(fromSelectValue(value) as TernaryChoice)}
        >
          <SelectTrigger className="h-8 min-w-32 rounded-full bg-card px-2 text-xs" aria-label={t("visitFactFor", { name: lead.provisionalStudentName })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("notDiscussed")}</SelectItem>
            <SelectItem value="yes">{t("visitCommitted")}</SelectItem>
            <SelectItem value="no">{t("visitNotCommitted")}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell className="min-w-36 px-2 py-2 align-top">
        <Select
          value={toSelectValue(interestLevel)}
          disabled={!reachable || contactRun.pending}
          onValueChange={(value) => setInterestLevel(fromSelectValue(value) as LeadInterestLevel | "")}
        >
          <SelectTrigger className="h-8 min-w-32 rounded-full bg-card px-2 text-xs" aria-label={t("interestLevelFor", { name: lead.provisionalStudentName })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={toSelectValue("")}>{t("interestUnrated")}</SelectItem>
            {(["A", "B", "C"] as const).map((value) => (
              <SelectItem key={value} value={value}>{t(`interest_${value}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      <TableCell className="min-w-80 px-2 py-2 align-top">
        <Textarea
          value={note}
          disabled={contactRun.pending}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          maxLength={2000}
          className="min-h-14 w-80 resize-y rounded-xl px-2 py-1.5 text-xs"
          placeholder={t("contactNotePlaceholder")}
          aria-label={t("contactNoteFor", { name: lead.provisionalStudentName })}
        />
      </TableCell>

      <TableCell className="min-w-44 px-2 py-2 align-top">
        <p className="min-h-5 text-[11px] leading-4 text-muted">
          {destination
            ? t("contactDestination", { status: t(`status_${destination}`) })
            : t("contactDestinationPending")}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-1 h-8 w-full whitespace-nowrap"
          disabled={!outcome || contactRun.pending}
          onClick={submit}
        >
          {contactRun.pending
            ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            : <Save className="size-4" />}
          {t("saveContactRow")}
        </Button>
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
  const freshCount = leads.filter((lead) => lead.contactCount === 0).length;
  const retryCount = leads.length - freshCount;
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: ACQUISITION_TIME_ZONE,
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));

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
        <Table className="w-full min-w-[112rem] text-xs" containerClassName="max-h-[calc(100dvh-15rem)] overflow-auto">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 top-0 z-30 h-8 min-w-64 bg-card px-2">{t("seed")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-72 bg-card px-2">{t("firstContactContext")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-40 bg-card px-2">{t("contactOutcome")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-36 bg-card px-2">{t("wechatFact")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-36 bg-card px-2">{t("visitFact")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-36 bg-card px-2">{t("interestLevel")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-80 bg-card px-2">{t("contactNote")}</TableHead>
              <TableHead className="sticky top-0 z-20 h-8 min-w-44 bg-card px-2">{t("contactRouting")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => <ContactEntryRow key={lead.id} lead={lead} formatAt={formatAt} />)}
          </TableBody>
        </Table>
      </DashboardTableShell>
    </div>
  );
}
