"use client";

import { Check, ChevronDown, ChevronRight, Copy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { updateLeadInvitationAction, type UpdateInvitationInput } from "./actions/invitations";
import { DashboardTableShell } from "./dashboard-page";
import { InvitationDraftFields } from "./InvitationDraftFields";
import {
  invitationDraftIsComplete,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationChannel,
  type InvitationCoordinationRow,
  type InvitationDraft,
  type InvitationState,
} from "./invitation-contract";

const CHANNELS = ["phone", "wechat", "in_person", "other"] as const;

function copyWithFallback(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error("COPY_FAILED"));
}

function arrangementText(
  row: InvitationCoordinationRow,
  t: ReturnType<typeof useTranslations<"school.invitations">>,
  formatAt: (value: string) => string,
): string {
  if (row.kind === "assessment_1v1") {
    return [
      row.proposedTimeText || t("timePending"),
      row.assessorName || t("assessorPending"),
      row.locationText || t("locationPending"),
    ].join(" · ");
  }
  if (row.kind === "activity") {
    return [
      row.activityTitle || t("activityPending"),
      row.activityScheduledAt ? formatAt(row.activityScheduledAt) : "",
      row.locationText,
    ].filter(Boolean).join(" · ");
  }
  return t("waitingActivityArrangement");
}

function InvitationEditor({
  row,
  activities,
  assessors,
  locale,
  formatAt,
  onSaved,
}: {
  row: InvitationCoordinationRow;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  formatAt: (value: string) => string;
  onSaved: (row: InvitationCoordinationRow, input: UpdateInvitationInput) => void;
}) {
  const t = useTranslations("school.invitations");
  const router = useRouter();
  const [draft, setDraft] = useState<InvitationDraft>({
    kind: row.kind,
    state: row.state,
    activityId: row.activityId,
    assessorId: row.assessorId,
    proposedTimeText: row.proposedTimeText,
    locationText: row.locationText,
  });
  const [channel, setChannel] = useState<InvitationChannel>("wechat");
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const updateRun = useAction(updateLeadInvitationAction, {
    successMessage: t("saveSuccess"),
    errorMessage: {
      INVALID_INVITATION: t("invalidDraft"),
      ACTIVITY_NOT_FOUND: t("activityUnavailable"),
      ASSESSOR_UNAVAILABLE: t("assessorUnavailable"),
      INVITATION_CLOSED: t("alreadyClosed"),
      LEAD_CLOSED: t("leadClosed"),
      LEAD_UNASSIGNED: t("leadUnassigned"),
      default: t("saveFailed"),
    },
    onSuccess: () => {
      const input = { ...draft, channel, note };
      onSaved(row, input);
      setNote("");
      setCancelOpen(false);
      router.refresh();
    },
  });
  const submit = (stateOverride?: InvitationState) => {
    const next = stateOverride ? { ...draft, state: stateOverride } : draft;
    updateRun.run(row.id, { ...next, channel, note });
  };
  const currentArrangement = arrangementText({
    ...row,
    ...draft,
    activityTitle: draft.activityId
      ? activities.find((activity) => activity.id === draft.activityId)?.title ?? ""
      : "",
    activityScheduledAt: draft.activityId
      ? activities.find((activity) => activity.id === draft.activityId)?.scheduledAt ?? null
      : null,
    assessorName: draft.assessorId
      ? assessors.find((assessor) => assessor.userId === draft.assessorId)?.displayName ?? ""
      : "",
  }, t, formatAt);
  const relayText = t("relayTemplate", {
    name: row.leadName,
    kind: t(`kind_${draft.kind}`),
    arrangement: currentArrangement,
    state: t(`state_${draft.state}`),
  });
  const draftComplete = invitationDraftIsComplete(draft);

  return (
    <div className="space-y-3 rounded-xl border border-line/70 bg-background/55 p-3">
      <InvitationDraftFields
        value={draft}
        activities={activities}
        assessors={assessors}
        locale={locale}
        disabled={updateRun.pending}
        allowNone={false}
        onChange={(value) => { if (value) setDraft(value); }}
      />

      <div className="grid gap-2 lg:grid-cols-[auto_minmax(18rem,1fr)]">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t("channelLabel")}>
          <span className="mr-1 text-[11px] text-muted">{t("channelLabel")}</span>
          {CHANNELS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant="secondary"
              className={cn("h-8 px-2.5 text-xs", channel === value && "border-moon bg-moon/35 text-ink")}
              aria-pressed={channel === value}
              disabled={updateRun.pending}
              onClick={() => setChannel(value)}
            >
              {channel === value ? <Check className="size-3" /> : null}
              {t(`channel_${value}`)}
            </Button>
          ))}
        </div>
        <Textarea
          value={note}
          disabled={updateRun.pending}
          rows={1}
          maxLength={2000}
          className="h-8 min-h-8 resize-y overflow-hidden rounded-xl px-2 py-1.5 text-xs transition-[height] focus:h-24 focus:overflow-auto motion-reduce:transition-none"
          placeholder={t("notePlaceholder")}
          aria-label={t("noteFor", { name: row.leadName })}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-8"
            disabled={updateRun.pending}
            onClick={() => copyWithFallback(relayText)
              .then(() => toast.success(t("copySuccess")))
              .catch(() => toast.error(t("copyFailed")))}
          >
            <Copy className="size-3.5" />
            {t("copyRelay")}
          </Button>
          <span className="max-w-2xl truncate text-[11px] text-muted" title={relayText}>{relayText}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" size="sm" variant="ghost" className="h-8" disabled={updateRun.pending} onClick={() => setCancelOpen(true)}>
            {t("cancelInvitation")}
          </Button>
          <Button type="button" size="sm" className="h-8" disabled={updateRun.pending || !draftComplete} onClick={() => submit()}>
            {updateRun.pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
            {note.trim() ? t("saveProgress") : t("saveArrangement")}
          </Button>
        </div>
      </div>

      <div className="border-t border-line pt-2">
        <p className="text-[11px] font-medium text-ink">{t("recentHistory")}</p>
        {row.events.length > 0 ? (
          <div className="mt-1 grid gap-1">
            {row.events.map((event) => (
              <p key={event.id} className="text-[11px] leading-4 text-muted">
                {formatAt(event.occurredAt)} · {event.recordedByName || t("unknownOperator")} · {t(`channel_${event.channel}`)} · {t(`state_${event.toState}`)}
                {event.note ? ` · ${event.note}` : ""}
              </p>
            ))}
          </div>
        ) : <p className="mt-1 text-[11px] text-muted">{t("noHistory")}</p>}
      </div>
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelTitle")}
        description={t("cancelDescription", { name: row.leadName })}
        confirmLabel={t("cancelInvitation")}
        cancelLabel={t("keepInvitation")}
        pending={updateRun.pending}
        onConfirm={() => submit("cancelled")}
      />
    </div>
  );
}

export function InvitationCoordinationWorkbench({
  rows,
  activities,
  assessors,
  locale,
}: {
  rows: InvitationCoordinationRow[];
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
}) {
  const t = useTranslations("school.invitations");
  const [sessionRows, setSessionRows] = useState(rows);
  const [activeId, setActiveId] = useState<string | null>(() => rows[0]?.id ?? null);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));
  const onSaved = (row: InvitationCoordinationRow, input: UpdateInvitationInput) => {
    const savedAt = new Date().toISOString();
    const activity = input.activityId ? activities.find((item) => item.id === input.activityId) : undefined;
    const assessor = input.assessorId ? assessors.find((item) => item.userId === input.assessorId) : undefined;
    setSessionRows((current) => current.map((item) => item.id === row.id ? {
      ...item,
      ...input,
      activityTitle: activity?.title ?? "",
      activityScheduledAt: activity?.scheduledAt ?? null,
      assessorName: assessor?.displayName ?? "",
      summary: input.note.trim() || item.summary,
      updatedAt: savedAt,
      events: [{
        id: `session-${Date.now()}`,
        fromState: item.state,
        toState: input.state,
        channel: input.channel,
        note: input.note,
        recordedByName: t("currentOperator"),
        occurredAt: savedAt,
      }, ...item.events].slice(0, 3),
    } : item));
  };

  return (
    <DashboardTableShell>
      <Table className="w-full min-w-[64rem] text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-30 h-9 min-w-56 border-r border-line bg-card px-2">{t("leadColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-36 bg-card px-2">{t("kindColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-96 bg-card px-2">{t("arrangementColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-36 bg-card px-2">{t("stateColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-32 bg-card px-2">{t("updatedColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessionRows.map((row) => {
            const closed = row.state === "completed" || row.state === "cancelled";
            const active = !closed && activeId === row.id;
            return (
              <Fragment key={row.id}>
                <TableRow
                  aria-selected={active}
                  className={cn(!closed && "cursor-pointer", active && "bg-moon/10 hover:bg-moon/10")}
                  onClick={() => { if (!closed) setActiveId(active ? null : row.id); }}
                >
                  <TableCell
                    className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2"
                    style={active ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" } : undefined}
                  >
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {closed ? <span className="size-3.5" /> : active ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                      <span className="font-medium text-ink">{row.leadName}</span>
                      <a className="font-mono text-[11px] text-ink underline-offset-4 hover:underline" href={`tel:${row.phone}`} onClick={(event) => event.stopPropagation()}>{row.phone}</a>
                    </div>
                    <p className="mt-0.5 pl-5 text-[11px] text-muted">{row.gradeText || t("gradePending")}{row.ownerName ? ` · ${row.ownerName}` : ""}</p>
                  </TableCell>
                  <TableCell className="px-2 py-2"><Badge variant="outline">{t(`kind_${row.kind}`)}</Badge></TableCell>
                  <TableCell className="max-w-[34rem] px-2 py-2">
                    <p className="truncate text-ink" title={arrangementText(row, t, formatAt)}>{arrangementText(row, t, formatAt)}</p>
                    {row.summary ? <p className="mt-0.5 truncate text-[11px] text-muted" title={row.summary}>{row.summary}</p> : null}
                  </TableCell>
                  <TableCell className="px-2 py-2"><Badge variant={row.state === "confirmed" ? "secondary" : "outline"}>{t(`state_${row.state}`)}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap px-2 py-2 text-muted">{formatAt(row.updatedAt)}</TableCell>
                </TableRow>
                {active ? (
                  <TableRow className="bg-moon/5 hover:bg-moon/5">
                    <TableCell colSpan={5} className="p-2">
                      <InvitationEditor
                        row={row}
                        activities={activities}
                        assessors={assessors}
                        locale={locale}
                        formatAt={formatAt}
                        onSaved={onSaved}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </DashboardTableShell>
  );
}
