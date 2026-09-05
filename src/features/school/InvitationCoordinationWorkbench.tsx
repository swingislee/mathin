"use client";

import { Check, ChevronDown, ChevronRight, Copy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  updateAssessorAvailabilityAction,
  updateLeadInvitationAction,
  type UpdateInvitationInput,
} from "./actions/invitations";
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
  ASSESSMENT_TIME_ZONE,
  assessmentAvailabilityIntersection,
  assessmentTimeOptionToInstant,
  invitationCanHaveNextContactReminder,
  invitationDraftIsComplete,
  invitationWorkStep,
  parseAssessmentTimeOption,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationChannel,
  type InvitationCoordinationStage,
  type InvitationCoordinationRow,
  type InvitationDraft,
  type InvitationQueue,
  type InvitationQueueCounts,
} from "./invitation-contract";
import { isFutureNextContactReminder } from "./NextContactReminderField";
import { zonedDateTimeToInstant } from "./schedule";
import { FollowupChoice, followupToneClasses } from "./dashboard-page/FollowupChoice";
import { FollowupInlineDetails } from "./dashboard-page/FollowupInlineDetails";
import { PostActivityHandoff } from "./EnrollmentHandoffButton";
import { PostActivityQuickContact } from "./PostActivityQuickContact";
import { followupState, type ActivityEnrollmentContext } from "./enrollment-workflow-contract";
import { LeadContactEntryRow } from "./LeadFirstContactWorkbench";
import { deriveLeadContactDestination, type LeadPoolRow } from "./lead-contract";
import type { LeadContactInput } from "./actions/leads";
import { communicationDayBounds, type CommunicationDayEvent, type CommunicationWorkbenchView, type CommunicationWorkday, type CommunicationWorklist } from "./communication-workday-contract";
import { completeCommunicationWorklistItemAction } from "./communication-workday-actions";
import { CommunicationDaySummary } from "./CommunicationDaySummary";
import { useCommunicationWorkSelection } from "./CommunicationWorkSelection";
import { communicationFactWithOverride, nextUnprocessedCommunicationKey, reconcileCommunicationWorkSession, type CommunicationWorkSession } from "./communication-work-session";

const CHANNELS = ["phone", "wechat", "in_person", "other"] as const;
const EMPTY_VALUE = "$empty";
const EMPTY_CONTACT_LEADS: LeadPoolRow[] = [];
type InvitationTableColumn = "lead" | "state" | "arrangement" | "updated";

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
    const overlapCount = assessmentAvailabilityIntersection(
      row.parentTimeOptions,
      row.assessorTimeOptions,
    ).length;
    const availability = row.scheduledAt
      ? t("availabilityConfirmed", { time: formatAt(row.scheduledAt) })
      : row.parentTimeOptions.length + row.assessorTimeOptions.length > 0
        ? t("availabilityCounts", {
            parent: row.parentTimeOptions.length,
            assessor: row.assessorTimeOptions.length,
            overlap: overlapCount,
          })
        : row.legacyTimeText || t("timePending");
    return [
      availability,
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

function sameOptions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function draftMatchesRow(draft: InvitationDraft, row: InvitationDraft): boolean {
  return draft.kind === row.kind
    && draft.state === row.state
    && draft.activityId === row.activityId
    && draft.assessorId === row.assessorId
    && sameOptions(draft.parentTimeOptions, row.parentTimeOptions)
    && sameOptions(draft.assessorTimeOptions, row.assessorTimeOptions)
    && draft.scheduledAt === row.scheduledAt
    && draft.locationText === row.locationText
    && (draft.nextContactAt ?? null) === row.nextContactAt;
}

function invitationDraftFrom(row: InvitationDraft): InvitationDraft {
  return { kind: row.kind, state: row.state, activityId: row.activityId, assessorId: row.assessorId,
    parentTimeOptions: row.parentTimeOptions, assessorTimeOptions: row.assessorTimeOptions,
    scheduledAt: row.scheduledAt, locationText: row.locationText, nextContactAt: row.nextContactAt ?? null };
}

function mergeInvitationDraft(base: InvitationDraft, draft: InvitationDraft, incoming: InvitationDraft): InvitationDraft {
  if (draft.kind !== base.kind) return draft;
  const latest = invitationDraftFrom(incoming);
  const changed = Object.fromEntries((Object.keys(latest) as (keyof InvitationDraft)[]).flatMap((key) => {
    const before = base[key];
    const value = draft[key];
    const equal = Array.isArray(before) && Array.isArray(value) ? sameOptions(before, value) : before === value;
    return equal ? [] : [[key, value]];
  }));
  return { ...latest, ...changed };
}

function InvitationEditor({
  row,
  activities,
  assessors,
  locale,
  formatAt,
  currentUserId,
  canManageInvitation,
  onSaved,
  saving,
  beginSave,
  endSave,
}: {
  row: InvitationCoordinationRow;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  formatAt: (value: string) => string;
  currentUserId: string;
  canManageInvitation: boolean;
  onSaved: (row: InvitationCoordinationRow, input: UpdateInvitationInput) => void;
  saving: boolean;
  beginSave: (id: string) => boolean;
  endSave: (id: string) => void;
}) {
  const t = useTranslations("school.invitations");
  const router = useRouter();
  const [draft, setDraft] = useState<InvitationDraft>({
    kind: row.kind,
    state: row.state,
    activityId: row.activityId,
    assessorId: row.assessorId,
    parentTimeOptions: row.parentTimeOptions,
    assessorTimeOptions: row.assessorTimeOptions,
    scheduledAt: row.scheduledAt,
    locationText: row.locationText,
    nextContactAt: row.nextContactAt,
  });
  const [draftBase, setDraftBase] = useState(() => invitationDraftFrom(row));
  if (!draftMatchesRow(draftBase, row)) {
    setDraft((current) => mergeInvitationDraft(draftBase, current, row));
    setDraftBase(invitationDraftFrom(row));
  }
  const ownsSave = useRef(false);
  const finishSaving = useCallback(() => {
    if (!ownsSave.current) return;
    ownsSave.current = false;
    endSave(row.id);
  }, [endSave, row.id]);
  const [channel, setChannel] = useState<InvitationChannel>("wechat");
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [autoFlowFailed, setAutoFlowFailed] = useState(false);
  const submittedInputRef = useRef<UpdateInvitationInput | null>(null);
  const [draftStorageKey] = useState(() => invitationDraftSessionKey("coordination", row.id, row.updatedAt));
  const assessorEditing = !canManageInvitation && row.assessorId === currentUserId;
  const updateRun = useAction(updateLeadInvitationAction, {
    successMessage: () => {
      const input = submittedInputRef.current;
      if (input?.state === "awaiting_teacher") {
        const assessor = assessors.find((item) => item.userId === input.assessorId)?.displayName ?? t("assessorPending");
        return t("teacherHandoffSavedToast", { assessor });
      }
      if (input?.state === "confirmed") return t("directBookingSavedToast");
      return t("saveSuccess");
    },
    errorMessage: {
      INVALID_INVITATION: t("invalidDraft"),
      ACTIVITY_NOT_FOUND: t("activityUnavailable"),
      ASSESSOR_UNAVAILABLE: t("assessorUnavailable"),
      INVITATION_CLOSED: t("alreadyClosed"),
      LEAD_CLOSED: t("leadClosed"),
      LEAD_UNASSIGNED: t("leadUnassigned"),
      REMINDER_NOT_FUTURE: t("nextContactReminderPast"),
      REMINDER_NOT_ALLOWED: t("nextContactReminderNotAllowed"),
      default: t("saveFailed"),
    },
    onSuccess: () => {
      finishSaving();
      const input = submittedInputRef.current;
      if (!input) return;
      submittedInputRef.current = null;
      clearInvitationDraftSession(draftStorageKey);
      setDraftBase(invitationDraftFrom(input));
      setDraft({
        kind: input.kind,
        state: input.state,
        activityId: input.activityId,
        assessorId: input.assessorId,
        parentTimeOptions: input.parentTimeOptions,
        assessorTimeOptions: input.assessorTimeOptions,
        scheduledAt: input.scheduledAt,
        locationText: input.locationText,
        nextContactAt: input.nextContactAt ?? null,
      });
      onSaved(row, input);
      setNote("");
      setCancelOpen(false);
      setAutoFlowFailed(false);
      router.refresh();
    },
    onError: () => {
      finishSaving();
      if (submittedInputRef.current?.state === "confirmed") setAutoFlowFailed(true);
    },
  });
  const assessorRun = useAction(updateAssessorAvailabilityAction, {
    successMessage: t("assessorAvailabilitySaveSuccess"),
    errorMessage: {
      ASSESSOR_SCOPE: t("assessorScopeError"),
      INVITATION_CLOSED: t("alreadyClosed"),
      INVALID_INVITATION: t("invalidDraft"),
      default: t("saveFailed"),
    },
    onSuccess: () => {
      finishSaving();
      clearInvitationDraftSession(draftStorageKey);
      const hasOverlap = assessmentAvailabilityIntersection(
        draft.parentTimeOptions,
        draft.assessorTimeOptions,
      ).length > 0;
      const nextState = hasOverlap
        ? "awaiting_parent" as const
        : draft.parentTimeOptions.length > 0
          ? "coordinating_time" as const
          : draft.state;
      setDraft((current) => ({ ...current, state: nextState }));
      onSaved(row, { ...draft, state: nextState, channel: "other", note: "" });
      router.refresh();
    },
    onError: finishSaving,
  });
  const operationPending = updateRun.pending || assessorRun.pending;
  useEffect(() => { if (!operationPending) finishSaving(); }, [finishSaving, operationPending]);
  const pending = operationPending || saving;
  const submitSupport = (nextDraft: InvitationDraft) => {
    const normalizedDraft = invitationCanHaveNextContactReminder(nextDraft)
      ? { ...nextDraft, nextContactAt: nextDraft.nextContactAt ?? null }
      : { ...nextDraft, nextContactAt: null };
    if (!isFutureNextContactReminder(normalizedDraft.nextContactAt)) {
      toast.error(t("nextContactReminderPast"));
      return;
    }
    if (normalizedDraft.state === "confirmed") setAutoFlowFailed(false);
    const input = { ...normalizedDraft, channel, note };
    if (!beginSave(row.id)) return;
    ownsSave.current = true;
    submittedInputRef.current = input;
    updateRun.run(row.id, input);
  };
  const copyText = (value: string) => {
    void copyWithFallback(value)
      .then(() => toast.success(t("copySuccess")))
      .catch(() => toast.error(t("copyFailed")));
  };
  const sharedOptions = assessmentAvailabilityIntersection(
    draft.parentTimeOptions,
    draft.assessorTimeOptions,
  );
  const exactSharedOptions = sharedOptions.flatMap((option) => {
    const instant = assessmentTimeOptionToInstant(option);
    return instant ? [{ option, instant }] : [];
  });
  const broadSharedCount = sharedOptions.length - exactSharedOptions.length;
  const workStep = invitationWorkStep(draft);
  const selectedActivity = draft.activityId
    ? activities.find((activity) => activity.id === draft.activityId)
    : undefined;
  const assessorName = draft.assessorId
    ? assessors.find((assessor) => assessor.userId === draft.assessorId)?.displayName ?? t("assessorPending")
    : t("assessorPending");
  const optionFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ASSESSMENT_TIME_ZONE,
  }), [locale]);
  const optionDayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: ASSESSMENT_TIME_ZONE,
  }), [locale]);
  const optionListFormatter = useMemo(() => new Intl.ListFormat(locale, {
    style: "short",
    type: "conjunction",
  }), [locale]);
  const formatOption = (option: string) => {
    const instant = assessmentTimeOptionToInstant(option);
    if (instant) return optionFormatter.format(new Date(instant));
    const parsed = parseAssessmentTimeOption(option);
    if (!parsed) return option;
    const [year, month, day] = parsed.dayKey.split("-").map(Number);
    const dayInstant = zonedDateTimeToInstant({ year, month: month - 1, day }, ASSESSMENT_TIME_ZONE);
    return `${optionDayFormatter.format(dayInstant)} · ${t("availabilityAfterSchoolSlot")}`;
  };
  const compactOptions = (options: readonly string[]) => {
    const visible = optionListFormatter.format(options.slice(0, 5).map(formatOption));
    return options.length > 5
      ? t("availabilityMoreCount", { options: visible, count: options.length - 5 })
      : visible;
  };
  const currentArrangement = arrangementText({
    ...row,
    ...draft,
    activityTitle: selectedActivity?.title ?? "",
    activityScheduledAt: selectedActivity?.scheduledAt ?? null,
    assessorName: draft.assessorId ? assessorName : "",
  }, t, formatAt);
  const relayText = t("relayTemplate", {
    name: row.leadName,
    kind: t(`kind_${draft.kind}`),
    arrangement: currentArrangement,
    state: t(`state_${draft.state}`),
  });
  const teacherRequestText = t("teacherRequestTemplate", {
    name: row.leadName,
    grade: row.gradeText || t("gradePending"),
    assessor: assessorName,
    options: compactOptions(draft.parentTimeOptions),
  });
  const selectedTimeText = draft.scheduledAt ? formatAt(draft.scheduledAt) : "";
  const parentConfirmationText = t("parentConfirmationTemplate", {
    name: row.leadName,
    time: selectedTimeText,
    assessor: assessorName,
    location: draft.locationText || t("locationToConfirm"),
  });
  const activityConfirmationText = t("activityConfirmationTemplate", {
    name: row.leadName,
    activity: selectedActivity?.title ?? t("activityPending"),
    time: selectedActivity ? formatAt(selectedActivity.scheduledAt) : "",
    location: draft.locationText || selectedActivity?.location || t("locationToConfirm"),
  });
  const dirty = !draftMatchesRow(draft, row);
  const confirmedDraftComplete = invitationDraftIsComplete(draft);
  const teacherHandoffNeedsSave = dirty || row.state !== "awaiting_teacher" || Boolean(note.trim());
  const candidateNeedsSave = dirty || row.state !== "awaiting_parent" || Boolean(note.trim());

  const supportActionContent = (() => {
    const header = (title: string, hint: string) => (
      <p className="min-w-0 break-words text-xs font-medium text-ink" title={hint}>{title}</p>
    );
    if (workStep === "collect_arrangement") {
      return (
        <>
          {header(t("workTitle_collect_arrangement"), t("workHint_collect_arrangement"))}
          <div className="grid gap-1.5 text-[11px]">
            <p className="flex items-center justify-between gap-3"><span className="text-muted">{t("workFactParent")}</span><span className="text-right text-ink">{draft.parentTimeOptions.length > 0 ? t("availabilitySlotCount", { count: draft.parentTimeOptions.length }) : t("notRecorded")}</span></p>
            <p className="flex items-center justify-between gap-3"><span className="text-muted">{t("workFactAssessor")}</span><span className="text-right text-ink">{draft.assessorId ? assessorName : t("notRecorded")}</span></p>
          </div>
          <Button type="button" size="sm" className="h-9 w-full" disabled={pending || (!dirty && !note.trim())} onClick={() => submitSupport({ ...draft, state: "coordinating_time" })}>
            {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
            {t("saveKnownFacts")}
          </Button>
        </>
      );
    }
    if (workStep === "waiting_assessor") {
      return (
        <>
          {header(t("workTitle_waiting_assessor"), t("workHint_waiting_assessor"))}
          <p className="border-l-2 border-moon pl-3 text-[11px] leading-5 text-ink">{compactOptions(draft.parentTimeOptions)}</p>
          <Button
            type="button"
            size="sm"
            className="h-9 w-full"
            disabled={pending}
            onClick={() => {
              copyText(teacherRequestText);
              if (teacherHandoffNeedsSave) submitSupport({ ...draft, state: "awaiting_teacher" });
            }}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Copy className="size-4" />}
            {teacherHandoffNeedsSave ? t("saveAndCopyTeacher") : t("copyTeacherRequest")}
          </Button>
        </>
      );
    }
    if (workStep === "waiting_assessor_response") {
      return (
        <>
          {header(t("workTitle_waiting_assessor_response"), t("workHint_waiting_assessor_response", { assessor: assessorName }))}
          <p className="border-l-2 border-moon pl-3 text-[11px] leading-5 text-ink">{compactOptions(draft.parentTimeOptions)}</p>
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted" aria-label={t("teacherHandoffPathLabel")}>
            <span className="rounded-full bg-leaf/20 px-2 py-1 text-ink">{t("teacherHandoffStepTeacher")}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("teacherHandoffStepOverlap")}</span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{t("teacherHandoffStepSupport")}</span>
          </div>
          <Button type="button" size="sm" variant="secondary" className="h-8 w-full" disabled={pending} onClick={() => copyText(teacherRequestText)}>
            <Copy className="size-3.5" />
            {t("copyTeacherRequestAgain")}
          </Button>
        </>
      );
    }
    if (workStep === "resolve_time_conflict") {
      return (
        <>
          {header(t("workTitle_resolve_time_conflict"), t("workHint_resolve_time_conflict"))}
          <p className="text-[11px] text-ink">{t("availabilityCounts", {
            parent: draft.parentTimeOptions.length,
            assessor: draft.assessorTimeOptions.length,
            overlap: 0,
          })}</p>
          <Button type="button" size="sm" className="h-9 w-full" disabled={pending || (!dirty && !note.trim())} onClick={() => submitSupport({ ...draft, state: "coordinating_time", scheduledAt: null })}>
            {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
            {t("saveTimeAdjustment")}
          </Button>
        </>
      );
    }
    if (workStep === "choose_shared_time") {
      return (
        <>
          {header(t("workTitle_choose_shared_time"), t("workHint_choose_shared_time"))}
          <FollowupChoice label={t("timeLabel")} value={draft.scheduledAt ?? ""} disabled={pending}
            onValueChange={(instant) => setDraft({ ...draft, scheduledAt: instant })}
            options={exactSharedOptions.map(({ option, instant }) => ({ value: instant, label: formatOption(option), tone: "healthy" }))} />
          {broadSharedCount > 0 ? <p className="text-[11px] leading-5 text-amber-700">{t("workRangeNeedsDetail", { count: broadSharedCount })}</p> : null}
          {exactSharedOptions.length === 0 ? <p className="text-[11px] leading-5 text-muted">{t("workNoExactSharedTime")}</p> : null}
        </>
      );
    }
    if (workStep === "confirm_with_parent") {
      const alreadyWaiting = !candidateNeedsSave && row.state === "awaiting_parent";
      return (
        <>
          {header(t("workTitle_confirm_with_parent"), t("workHint_confirm_with_parent"))}
          <div className="border-l-2 border-rose pl-3">
            <p className="text-sm font-medium text-ink">{selectedTimeText}</p>
            <p className="mt-0.5 text-[11px] text-muted">{assessorName} · {draft.locationText || t("locationToConfirm")}</p>
          </div>
          {exactSharedOptions.length > 1 ? (
            <FollowupChoice label={t("timeLabel")} value={draft.scheduledAt ?? ""} disabled={pending}
              onValueChange={(instant) => setDraft({ ...draft, scheduledAt: instant })}
              options={exactSharedOptions.map(({ option, instant }) => ({ value: instant, label: formatOption(option), tone: "healthy" }))} />
          ) : null}
          {alreadyWaiting ? (
            <>
              <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "confirmed" })}>
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
                {t("parentConfirmed")}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="h-8 w-full" disabled={pending} onClick={() => copyText(parentConfirmationText)}>
                <Copy className="size-3.5" />
                {t("copyParentConfirmation")}
              </Button>
              {note.trim() ? (
                <Button type="button" size="sm" variant="ghost" className="h-8 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "awaiting_parent" })}>
                  {t("recordAndWait")}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                className="h-9 w-full"
                disabled={pending}
                onClick={() => {
                  copyText(parentConfirmationText);
                  submitSupport({ ...draft, state: "awaiting_parent" });
                }}
              >
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Copy className="size-4" />}
                {t("saveCandidateAndCopy")}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="h-8 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "confirmed" })}>
                <Check className="size-3.5" />
                {t("parentConfirmedDirect")}
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="ghost" className="h-7 w-full text-[11px]" disabled={pending} onClick={() => setDraft({ ...draft, state: "coordinating_time", scheduledAt: null })}>
            {t("chooseAnotherTime")}
          </Button>
        </>
      );
    }
    if (workStep === "choose_activity") {
      return <>{header(t("workTitle_choose_activity"), t("workHint_choose_activity"))}</>;
    }
    if (workStep === "confirm_activity") {
      const alreadyWaiting = !dirty && row.state === "awaiting_parent";
      return (
        <>
          {header(t("workTitle_confirm_activity"), t("workHint_confirm_activity"))}
          {selectedActivity ? (
            <div className="border-l-2 border-moon pl-3">
              <p className="text-sm font-medium text-ink">{selectedActivity.title}</p>
              <p className="mt-0.5 text-[11px] text-muted">{formatAt(selectedActivity.scheduledAt)} · {draft.locationText || selectedActivity.location || t("locationToConfirm")}</p>
            </div>
          ) : null}
          {alreadyWaiting ? (
            <>
              <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "confirmed" })}>
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
                {t("parentConfirmed")}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="h-8 w-full" disabled={pending} onClick={() => copyText(activityConfirmationText)}>
                <Copy className="size-3.5" />
                {t("copyParentConfirmation")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => { copyText(activityConfirmationText); submitSupport({ ...draft, state: "awaiting_parent" }); }}>
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Copy className="size-4" />}
                {t("saveActivityAndCopy")}
              </Button>
              <Button type="button" size="sm" variant="secondary" className="h-8 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "confirmed" })}>
                <Check className="size-3.5" />
                {t("parentConfirmedDirect")}
              </Button>
            </>
          )}
        </>
      );
    }
    if (workStep === "waiting_activity") {
      return (
        <>
          {header(t("workTitle_waiting_activity"), t("workHint_waiting_activity"))}
          <Button type="button" size="sm" className="h-9 w-full" disabled={pending || (!dirty && !note.trim())} onClick={() => submitSupport({ ...draft, state: "waiting_activity" })}>
            {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
            {t("saveKnownFacts")}
          </Button>
        </>
      );
    }
    if (workStep === "confirmed" && dirty) {
      const shouldAutoFlow = draft.kind === "assessment_1v1" && row.state !== "confirmed";
      return (
        <>
          {header(
            shouldAutoFlow
              ? confirmedDraftComplete ? t("workTitle_direct_booking_ready") : t("workTitle_confirmed_incomplete")
              : confirmedDraftComplete ? t("workTitle_confirmed_changes") : t("workTitle_confirmed_edit_incomplete"),
            shouldAutoFlow
              ? confirmedDraftComplete ? t("workHint_direct_booking_ready") : t("workHint_confirmed_incomplete")
              : confirmedDraftComplete ? t("workHint_confirmed_changes") : t("workHint_confirmed_edit_incomplete"),
          )}
          <div className="border-l-2 border-rose pl-3">
            <p className="text-sm font-medium text-ink">{currentArrangement}</p>
          </div>
          {shouldAutoFlow ? (
            confirmedDraftComplete ? (
              autoFlowFailed ? (
                <Button type="button" size="sm" variant="secondary" className="h-9 w-full" disabled={pending} onClick={() => submitSupport(draft)}>
                  {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                  {t("retryAutoConfirm")}
                </Button>
              ) : (
                <p className="flex items-center gap-2 rounded-lg bg-leaf/15 px-3 py-2 text-[11px] text-ink" role="status">
                  <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                  {t("autoConfirming")}
                </p>
              )
            ) : (
              <p className="rounded-lg bg-moon/20 px-3 py-2 text-[11px] leading-5 text-ink" role="status">
                {t("confirmedNeedsExactTime")}
              </p>
            )
          ) : confirmedDraftComplete ? (
            <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => submitSupport(draft)}>
              {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
              {t("saveConfirmedChanges")}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" className="h-8 w-full" disabled={pending} onClick={() => setDraft({ ...draft, state: "coordinating_time", scheduledAt: null })}>
            {t("backToCoordination")}
          </Button>
        </>
      );
    }
    return (
      <>
        {header(t("workTitle_confirmed"), t("workHint_confirmed"))}
        <div className="border-l-2 border-leaf-deep pl-3">
          <p className="text-sm font-medium text-ink">{currentArrangement}</p>
        </div>
        <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => copyText(relayText)}>
          <Copy className="size-4" />
          {t("copyRelay")}
        </Button>
        {draft.kind === "assessment_1v1" ? (
          <Button type="button" size="sm" variant="ghost" className="h-8 w-full" disabled={pending} onClick={() => setDraft({ ...draft, state: "coordinating_time", scheduledAt: null })}>
            {t("recoordinate")}
          </Button>
        ) : null}
      </>
    );
  })();

  if ((!canManageInvitation && !assessorEditing) || row.state === "completed" || row.state === "cancelled") {
    return <div className="grid gap-3 text-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="space-y-2"><p>{currentArrangement}</p><Badge variant="outline">{t(`state_${row.state}`)}</Badge></div>
      <div className="space-y-2">{row.events.map((event) => <p key={event.id} className="whitespace-pre-wrap text-muted">{formatAt(event.occurredAt)} · {event.note || t(`state_${event.toState}`)}</p>)}</div></div>;
  }
  return (
    <div className="@container/invitation-editor min-w-0 max-w-full px-1">
      <div className="grid min-w-0 items-start gap-4 @[56rem]/invitation-editor:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <InvitationDraftFields
          value={draft}
          activities={activities}
          assessors={assessors}
          locale={locale}
          disabled={pending}
          allowNone={false}
          variant="workflow"
          editingScope={assessorEditing ? "assessor" : "full"}
          draftStorageKey={draftStorageKey}
          onChange={(value) => { if (value) setDraft(value); }}
          onConfirmedReady={(value) => {
            if (!assessorEditing && row.state !== "confirmed") submitSupport(value);
          }}
        />

        <section className="min-w-0 max-w-full space-y-2.5 border-line @[56rem]/invitation-editor:border-l @[56rem]/invitation-editor:pl-4 [&_button]:h-auto [&_button]:min-h-8 [&_button]:min-w-0 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:py-1.5 [&_p]:break-words">
          {assessorEditing ? (
            <>
              <p className="text-sm font-medium text-ink">{t("assessorAvailabilityTitle")}</p>
              <p className="text-[11px] text-ink">{sharedOptions.length > 0
                ? t("assessorOverlapFound", { count: sharedOptions.length })
                : t("assessorOverlapPending")}</p>
              <Button
                type="button"
                size="sm"
                className="h-9 w-full"
                disabled={pending || sameOptions(draft.assessorTimeOptions, row.assessorTimeOptions)}
                onClick={() => { if (beginSave(row.id)) { ownsSave.current = true; assessorRun.run(row.id, draft.assessorTimeOptions); } }}
              >
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
                {sharedOptions.length > 0 ? t("saveAssessorAvailabilityWithOverlap") : t("saveAssessorAvailability")}
              </Button>
            </>
          ) : (
            <>
              {supportActionContent}
              {workStep !== "confirmed" ? (
                <div className="min-w-0 space-y-2 border-t border-line pt-2">
                  <Label htmlFor={`invitation-note-${row.id}`} className="text-[11px] text-muted">{t("communicationOptional")}</Label>
                  <FollowupChoice className="w-28" label={t("channelLabel")} value={channel} onValueChange={(value) => setChannel(value as InvitationChannel)} disabled={pending}
                    options={CHANNELS.map((value) => ({ value, label: t(`channel_${value}`) }))} />
                  <Textarea
                    id={`invitation-note-${row.id}`}
                    value={note}
                    disabled={pending}
                    rows={1}
                    maxLength={2000}
                    className="min-h-9 min-w-0 max-w-full resize-y rounded-xl px-3 py-2 text-xs"
                    placeholder={t("notePlaceholder")}
                    aria-label={t("noteFor", { name: row.leadName })}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex justify-end border-t border-line pt-2">
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" disabled={pending} onClick={() => setCancelOpen(true)}>
                  {t("cancelInvitation")}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      {row.events.length > 0 ? <div className="mt-3 grid min-w-0 gap-2 border-t border-line pt-2 @[36rem]/invitation-editor:grid-cols-[6rem_minmax(0,1fr)]">
        <p className="text-[11px] font-medium text-ink">{t("recentHistory")}</p>
          <div className="grid min-w-0 gap-1">
            {row.events.map((event) => (
              <p key={event.id} className="truncate text-[11px] leading-4 text-muted" title={event.note || undefined}>
                {formatAt(event.occurredAt)} · {event.recordedByName || t("unknownOperator")} · {t(`channel_${event.channel}`)} · {t(`state_${event.toState}`)}
                {event.note ? ` · ${event.note}` : ""}
              </p>
            ))}
          </div>
      </div> : null}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("cancelTitle")}
        description={t("cancelDescription", { name: row.leadName })}
        confirmLabel={t("cancelInvitation")}
        cancelLabel={t("keepInvitation")}
        pending={pending}
        onConfirm={() => submitSupport({ ...draft, state: "cancelled" })}
      />
    </div>
  );
}

function InvitationQuickContact({ row, disabled, onSaved, saving, beginSave, endSave }: {
  row: InvitationCoordinationRow; disabled: boolean;
  onSaved: (row: InvitationCoordinationRow, input: UpdateInvitationInput) => void;
  saving: boolean;
  beginSave: (id: string) => boolean;
  endSave: (id: string) => void;
}) {
  const t = useTranslations("school.invitations");
  const [channel, setChannel] = useState<InvitationChannel>("wechat");
  const [note, setNote] = useState("");
  const submitted = useRef<UpdateInvitationInput | null>(null);
  const ownsSave = useRef(false);
  const finishSaving = useCallback(() => {
    if (!ownsSave.current) return;
    ownsSave.current = false;
    endSave(row.id);
  }, [endSave, row.id]);
  const run = useAction(updateLeadInvitationAction, { successMessage: t("saveSuccess"), errorMessage: { default: t("saveFailed") }, onSuccess: () => {
    finishSaving();
    if (submitted.current) onSaved(row, submitted.current);
    setNote(""); submitted.current = null;
  }, onError: finishSaving });
  useEffect(() => { if (!run.pending) finishSaving(); }, [finishSaving, run.pending]);
  const submit = () => {
    if (disabled || saving || run.pending || !note.trim()) return;
    const input: UpdateInvitationInput = { kind: row.kind, state: row.state, activityId: row.activityId, assessorId: row.assessorId,
      parentTimeOptions: row.parentTimeOptions, assessorTimeOptions: row.assessorTimeOptions, scheduledAt: row.scheduledAt,
      locationText: row.locationText, nextContactAt: row.nextContactAt, channel, note };
    if (!beginSave(row.id)) return;
    ownsSave.current = true;
    submitted.current = input;
    run.run(row.id, input);
  };
  return <div className="flex items-center gap-1.5" onKeyDown={(event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); submit(); }
  }}>
    <FollowupChoice className="w-28 shrink-0" label={t("channelLabel")} value={channel} onValueChange={(value) => setChannel(value as InvitationChannel)} disabled={disabled || saving || run.pending}
      options={CHANNELS.map((value) => ({ value, label: t(`channel_${value}`) }))} />
    <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("notePlaceholder")} aria-label={t("noteFor", { name: row.leadName })} disabled={disabled || saving || run.pending} maxLength={2000} className="h-8 min-w-0 flex-1 text-xs" />
    <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 px-2" onClick={submit} disabled={disabled || saving || run.pending || !note.trim()} aria-label={t("saveKnownFacts")} aria-keyshortcuts="Control+Enter Meta+Enter" title={`${t("saveKnownFacts")} · Ctrl ↵`}>
      {run.pending ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}</Button>
  </div>;
}

function InvitationHistory({ rows, formatAt }: { rows: InvitationCoordinationRow[]; formatAt: (value: string) => string }) {
  const t = useTranslations("school.invitations");
  if (!rows.length) return null;
  return <details className="min-w-0 border-t border-line pt-3 text-xs">
    <summary className="cursor-pointer text-muted">{t("previousInvitations")} · {rows.length}</summary>
    <div className="mt-2 grid min-w-0 gap-3">
      {rows.map((row) => <div key={row.id} className="min-w-0 space-y-1">
        <p className="break-words font-medium">{t(`kind_${row.kind}`)} · {t(`state_${row.state}`)} · {arrangementText(row, t, formatAt)}</p>
        <p className="text-[11px] text-muted">{formatAt(row.updatedAt)}{row.summary ? ` · ${row.summary}` : ""}</p>
        {row.events.map((event) => <p key={event.id} className="break-words text-[11px] text-muted">{formatAt(event.occurredAt)} · {event.recordedByName || t("unknownOperator")} · {t(`channel_${event.channel}`)} · {t(`state_${event.toState}`)}{event.note ? ` · ${event.note}` : ""}</p>)}
      </div>)}
    </div>
  </details>;
}

type CommunicationRow =
  | { id: string; source: "invitation"; value: InvitationCoordinationRow }
  | { id: string; source: "contact"; value: LeadPoolRow; previousInvitation?: InvitationCoordinationRow }
  | { id: string; source: "post_activity"; value: ActivityEnrollmentContext };

const communicationRowKey = (row: CommunicationRow) => row.source === "post_activity"
  ? `post:${row.value.registrationId}` : `lead:${row.source === "contact" ? row.value.id : row.value.leadId}`;
const sameCommunicationFact = (left: CommunicationRow, right: CommunicationRow) => left.source === right.source
  && left.value === right.value && (left.source !== "contact" || right.source !== "contact" || left.previousInvitation === right.previousInvitation);

export function InvitationCoordinationWorkbench({ rows, activities, assessors, locale, currentUserId, canManageInvitation, postActivityRows = [], searchQuery = "", contactLeads = EMPTY_CONTACT_LEADS, leadDetails = EMPTY_CONTACT_LEADS, canContact = false, canManageIdentity = false, focusLeadId, rowOrder, invitationHistory = [], workday, worklist, selectionEnabled = false, sessionKey = "communication", workMode }: {
  rows: InvitationCoordinationRow[]; activities: InvitationActivityOption[]; assessors: InvitationAssessorOption[]; locale: string;
  queue?: InvitationQueue; coordinationStage?: InvitationCoordinationStage | null; stageCounts?: InvitationQueueCounts["stages"];
  searchQuery?: string; currentUserId: string; canManageInvitation: boolean; postActivityRows?: ActivityEnrollmentContext[];
  contactLeads?: LeadPoolRow[]; leadDetails?: LeadPoolRow[]; canContact?: boolean; canManageIdentity?: boolean; focusLeadId?: string;
  rowOrder?: string[]; invitationHistory?: InvitationCoordinationRow[];
  workday?: CommunicationWorkday; worklist?: CommunicationWorklist; selectionEnabled?: boolean; sessionKey?: string;
  workMode?: CommunicationWorkbenchView;
}) {
  const t = useTranslations("school.invitations");
  const leadT = useTranslations("school.leads");
  const workspaceT = useTranslations("school.followupWorkspace");
  const enrollmentT = useTranslations("school.enrollmentWorkflow");
  const tableT = useTranslations("school.table");
  const workT = useTranslations("school.communicationWorkday");
  const workSelection = useCommunicationWorkSelection();
  const { setVisibleKeys } = workSelection;
  const router = useRouter();
  const [rowOverrides, setRowOverrides] = useState<Record<string, { base: InvitationCoordinationRow; value: InvitationCoordinationRow }>>({});
  const [workSession, setWorkSession] = useState<CommunicationWorkSession<CommunicationRow> | null>(null);
  const [postOverrides, setPostOverrides] = useState<Record<string, { base: ActivityEnrollmentContext; value: ActivityEnrollmentContext }>>({});
  const [processedKeys, setProcessedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [completionOverrides, setCompletionOverrides] = useState<Record<string, { base: string | null; completed: boolean }>>({});
  const [completingKeys, setCompletingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const completingRef = useRef(new Set<string>());
  const [leadSession, setLeadSession] = useState({ contacts: contactLeads, details: leadDetails, overrides: {} as Record<string, LeadPoolRow> });
  if (leadSession.contacts !== contactLeads || leadSession.details !== leadDetails) {
    setLeadSession({ contacts: contactLeads, details: leadDetails, overrides: {} });
  }
  const [recontactIds, setRecontactIds] = useState<ReadonlySet<string>>(() => new Set());
  const focusRowId = focusLeadId ? `lead:${focusLeadId}` : null;
  const [activeId, setActiveId] = useState<string | null>(focusRowId);
  const [activeContactId, setActiveContactId] = useState<string | null>(focusLeadId ?? null);
  const [acceptedFocusRowId, setAcceptedFocusRowId] = useState(focusRowId);
  if (acceptedFocusRowId !== focusRowId) {
    setAcceptedFocusRowId(focusRowId);
    if (focusRowId) { setActiveId(focusRowId); setActiveContactId(focusLeadId ?? null); }
  }
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  useEffect(() => {
    if (!focusRowId) return;
    const row = rowRefs.current.get(focusRowId);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }, [focusRowId]);
  const savingIdsRef = useRef(new Set<string>());
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const beginSave = useCallback((id: string) => {
    if (savingIdsRef.current.has(id)) return false;
    savingIdsRef.current.add(id);
    setSavingIds(new Set(savingIdsRef.current));
    return true;
  }, []);
  const endSave = useCallback((id: string) => {
    savingIdsRef.current.delete(id);
    setSavingIds(new Set(savingIdsRef.current));
  }, []);
  const canonicalFromId = (id: string) => id.startsWith("contact:") ? `lead:${id.slice(8)}`
    : rows.find((row) => row.id === id) ? `lead:${rows.find((row) => row.id === id)!.leadId}` : id;
  const isSavingKey = (key: string) => [...savingIdsRef.current].some((id) => canonicalFromId(id) === key);
  const changeDetails = (id: string, open: boolean) => {
    const key = canonicalFromId(id);
    if (!open && isSavingKey(key)) return;
    if (open && activeId && activeId !== key && isSavingKey(activeId)) return;
    setActiveId(open ? key : null);
    if (!open) rowRefs.current.get(key)?.focus({ preventScroll: true });
  };
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }), [locale]);
  const formatAt = useCallback((value: string) => dateTimeFormatter.format(new Date(value)), [dateTimeFormatter]);
  const recordsMode = workMode === "records";
  const dayEventsByKey = useMemo(() => {
    const grouped = new Map<string, CommunicationDayEvent[]>();
    if (!recordsMode || !workday) return grouped;
    const bounds = communicationDayBounds(workday.date);
    for (const event of workday.events) {
      if (Date.parse(event.occurredAt) < Date.parse(bounds.start) || Date.parse(event.occurredAt) >= Date.parse(bounds.end)) continue;
      grouped.set(event.key, [...(grouped.get(event.key) ?? []), event]);
    }
    for (const events of grouped.values()) events.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || a.id.localeCompare(b.id));
    return grouped;
  }, [recordsMode, workday]);
  const dayEventsFor = (row: CommunicationRow) => dayEventsByKey.get(communicationRowKey(row)) ?? [];
  const dayEventFor = (row: CommunicationRow) => dayEventsFor(row)[0];
  const dayOutcomeLabel = (event: CommunicationDayEvent | undefined) => event ? event.source === "invitation" ? t(`state_${event.outcome}`) : workT(`outcome_${event.outcome}`) : "—";
  const historicalSummaryFor = (row: CommunicationRow) => {
    if (!recordsMode) return undefined;
    const event = dayEventFor(row);
    const tone = !event ? "neutral" : ["connected", "confirmed", "completed"].includes(event.outcome) ? "healthy"
      : ["declined", "invalid_number", "cancelled", "closed"].includes(event.outcome) ? "unhealthy" : "attention";
    return {
      state: <><Badge variant="outline" className={cn("max-w-full truncate", followupToneClasses[tone])}>{dayOutcomeLabel(event)}</Badge><p className="mt-1 text-[11px] text-muted">{workT("dayEventCount", { count: dayEventsFor(row).length })}</p></>,
      details: <div className="flex min-w-0 items-center gap-2"><span className="shrink-0 text-[11px] text-muted">{event ? t(`channel_${event.channel}`) : "—"}</span><p className="truncate text-ink" title={event?.note}>{event?.note || "—"}</p></div>,
      updated: event ? <time dateTime={event.occurredAt}>{formatAt(event.occurredAt)}</time> : "—",
    };
  };
  const retainedContactLeads = [...(workSession?.facts.values() ?? [])].flatMap((row) => row.source === "contact" ? [row.value] : []);
  const leadById = new Map([...retainedContactLeads, ...leadDetails, ...contactLeads].map((lead) => [lead.id, leadSession.overrides[lead.id] ?? lead]));
  const invitedLeadIds = new Set(rows.map((row) => row.leadId));
  const hasPendingInvitation = (lead: LeadPoolRow) => lead.activeInvitation?.id === `session-${lead.id}`;
  const uniqueContactLeads = [...new Map(contactLeads.map((lead) => [lead.id, leadSession.overrides[lead.id] ?? lead])).values()];
  const combinedUnsorted: CommunicationRow[] = [
    ...rows.map((original): CommunicationRow => {
      const override = rowOverrides[original.id];
      const value = communicationFactWithOverride(original, override);
      const lead = leadById.get(value.leadId);
      if (recontactIds.has(value.id) && lead && (!lead.activeInvitation || hasPendingInvitation(lead)) && ["completed", "cancelled"].includes(value.state)) {
        return { id: `contact:${lead.id}`, source: "contact", value: lead, previousInvitation: value };
      }
      return { id: value.id, source: "invitation" as const, value };
    }),
    ...uniqueContactLeads.filter((lead) => (!lead.activeInvitation || hasPendingInvitation(lead)) && !invitedLeadIds.has(lead.id)).map((value) => ({ id: `contact:${value.id}`, source: "contact" as const, value })),
    ...postActivityRows.filter((row) => workday || worklist || row.eligible).map((original) => ({ id: `post:${original.registrationId}`, source: "post_activity" as const,
      value: communicationFactWithOverride(original, postOverrides[original.registrationId]) })),
  ];
  const orderById = new Map((worklist?.rowKeys ?? rowOrder ?? []).map((id, index) => [id, index]));
  const orderOf = (row: CommunicationRow) => orderById.get(row.source === "post_activity" ? `post:${row.value.registrationId}` : `lead:${row.source === "contact" ? row.value.id : row.value.leadId}`) ?? Number.MAX_SAFE_INTEGER;
  const combined = orderById.size ? [...combinedUnsorted].sort((left, right) => orderOf(left) - orderOf(right)) : combinedUnsorted;
  const historyFor = (leadId: string, currentId?: string) => invitationHistory.filter((row) => row.leadId === leadId && row.id !== currentId);
  const nameOf = (row: CommunicationRow) => row.source === "invitation" ? row.value.leadName : row.source === "contact" ? row.value.provisionalStudentName : row.value.name;
  const referenceRow = (row: CommunicationRow): CommunicationRow => row.source === "contact" && row.previousInvitation ? { id: row.previousInvitation.id, source: "invitation", value: row.previousInvitation } : row;
  const laterContactFor = (row: InvitationCoordinationRow) => {
    const lead = leadById.get(row.leadId);
    return ["completed", "cancelled"].includes(row.state) && lead?.lastContactAt
      && new Date(lead.lastContactAt).getTime() > new Date(row.updatedAt).getTime() ? lead : null;
  };
  const stateOf = (input: CommunicationRow) => { const row = referenceRow(input); return row.source === "invitation" ? t(`state_${row.value.state}`) : row.source === "contact" ? leadT(`status_${row.value.status}`) : enrollmentT(`state_${followupState(row.value)}`); };
  const kindOf = (input: CommunicationRow) => { const row = referenceRow(input); return row.source === "invitation" ? t(`kind_${row.value.kind}`) : row.source === "contact" ? leadT("firstContactEntry") : t("queue_post_activity"); };
  const arrangementOf = (input: CommunicationRow) => { const row = referenceRow(input); return row.source === "invitation" ? arrangementText(row.value, t, formatAt) : row.source === "contact" ? [row.value.acquisitionLocation, ...row.value.interests].filter(Boolean).join(" · ") || leadT("noSourceInterest") : row.value.activityTitle; };
  const updatedOf = (input: CommunicationRow) => { const row = referenceRow(input); return row.source === "invitation" ? laterContactFor(row.value)?.lastContactAt ?? row.value.updatedAt : row.source === "contact" ? row.value.lastContactAt ?? row.value.createdAt : row.value.contacts[0]?.occurredAt ?? row.value.activityAt; };
  const noteOf = (input: CommunicationRow) => {
    const row = referenceRow(input);
    if (row.source === "contact") return row.value.lastContactNote;
    if (row.source === "post_activity") return row.value.contacts[0]?.note || row.value.routeNote;
    const latest = laterContactFor(row.value);
    return latest ? [latest.lastContactOutcome ? leadT(`contactOutcome_${latest.lastContactOutcome}`) : "", latest.lastContactNote].filter(Boolean).join(" · ") : row.value.summary;
  };
  const stateValueOf = (input: CommunicationRow) => { const row = referenceRow(input); return row.source === "invitation" ? row.value.state : row.source === "contact" ? `contact:${row.value.status}` : `post:${followupState(row.value)}`; };
  const filtered = combined.filter((row) => [nameOf(row), row.value.phone, ...(recordsMode ? dayEventsFor(row).flatMap((event) => [event.note, dayOutcomeLabel(event), t(`channel_${event.channel}`)]) : [arrangementOf(row), noteOf(row)])].join(" ").toLocaleLowerCase(locale).includes(searchQuery.toLocaleLowerCase(locale)));
  const tableColumns: Record<InvitationTableColumn, DashboardTableColumnDefinition<CommunicationRow>> = {
    lead: { filterValues: (row) => [{ value: `name:${nameOf(row)}`, label: nameOf(row), group: tableT("fieldName") }, { value: `phone:${row.value.phone}`, label: row.value.phone || tableT("emptyValue"), group: tableT("fieldPhone") },
      { value: `grade:${row.value.gradeText || EMPTY_VALUE}`, label: row.value.gradeText || t("gradePending"), group: tableT("fieldGrade") },
      ...(row.source !== "post_activity" ? [{ value: `owner:${row.value.ownerName || EMPTY_VALUE}`, label: row.value.ownerName || tableT("emptyValue"), group: tableT("fieldOwner") }] : [])], sortValue: nameOf },
    state: { filterValues: (row) => recordsMode ? ({ value: `day:${dayEventFor(row)?.source}:${dayEventFor(row)?.outcome}`, label: dayOutcomeLabel(dayEventFor(row)) }) : ({ value: stateValueOf(row), label: stateOf(row) }), sortValue: (row) => recordsMode ? dayOutcomeLabel(dayEventFor(row)) : stateOf(row) },
    arrangement: { filterValues: (row) => recordsMode ? dayEventsFor(row).map((event) => ({ value: `channel:${event.channel}`, label: t(`channel_${event.channel}`) })) : [{ value: `type:${kindOf(row)}`, label: kindOf(row), group: tableT("fieldType") }, { value: `arrangement:${arrangementOf(row)}`, label: arrangementOf(row), group: tableT("fieldActivity") }], sortValue: (row) => recordsMode ? dayEventFor(row)?.note : arrangementOf(row) },
    updated: { filterValues: (row) => workday ? [] : ({ value: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(updatedOf(row))), label: formatAt(updatedOf(row)).split(" ")[0] }), sortValue: (row) => recordsMode ? dayEventFor(row)?.occurredAt : updatedOf(row) },
  };
  const table = useDashboardTableView({ rows: filtered, columns: tableColumns, locale, initialFilters: focusLeadId || worklist ? {} : undefined,
    persistenceKey: focusLeadId ? undefined : `school.followup.communication.${recordsMode ? "records" : workday ? "workday" : "v2"}.${worklist?.id ?? currentUserId}` });
  const selectionSignature = JSON.stringify({ filters: table.filters, sort: table.sort });
  const currentSession = reconcileCommunicationWorkSession(workSession, { boundary: sessionKey, selection: selectionSignature,
    rows: combined, selectedRows: table.visibleRows, authorizedKeys: rowOrder, keyOf: communicationRowKey, sameFact: sameCommunicationFact });
  if (currentSession !== workSession) setWorkSession(currentSession);
  const visibleRows = currentSession.keys.flatMap((key) => { const row = currentSession.facts.get(key); return row ? [row] : []; });
  const visibleKeysSignature = JSON.stringify(visibleRows.map(communicationRowKey));
  useEffect(() => { setVisibleKeys(JSON.parse(visibleKeysSignature) as string[]); }, [visibleKeysSignature, setVisibleKeys]);
  const canOperateRow = (row: CommunicationRow) => row.source === "contact" ? Boolean(canContact && row.value.ownerId && !row.value.activeInvitation && !["invalid", "converted"].includes(row.value.status))
    : row.source === "invitation" ? canManageInvitation && !["completed", "cancelled"].includes(row.value.state)
      : row.value.canContact && row.value.eligible && !row.value.enrollmentId && row.value.route !== "closed";
  const selectableKeys = visibleRows.filter(canOperateRow).map(communicationRowKey);
  const activeSource = visibleRows.find((row) => communicationRowKey(row) === activeId)?.source;
  useEffect(() => { if (activeId) rowRefs.current.get(activeId)?.focus({ preventScroll: true }); }, [activeId, activeSource]);

  const completedFor = (key: string) => {
    if (!worklist) return processedKeys.has(key);
    const saved = worklist.items.find((item) => item.key === key)?.completedAt ?? null;
    const override = completionOverrides[key];
    return override && override.base === saved ? override.completed : Boolean(saved);
  };
  const setCompletion = async (key: string, completed: boolean) => {
    if (!worklist || worklist.closedAt || completingRef.current.has(key)) return;
    completingRef.current.add(key);
    setCompletingKeys(new Set(completingRef.current));
    try {
      const result = await completeCommunicationWorklistItemAction({ worklistId: worklist.id, key, completed });
      if (!result.ok) { toast.error(workT("completeFailed")); return; }
      setCompletionOverrides((current) => ({ ...current, [key]: { base: worklist.items.find((item) => item.key === key)?.completedAt ?? null, completed } }));
      setProcessedKeys((current) => { const next = new Set(current); if (completed) next.add(key); else next.delete(key); return next; });
      router.refresh();
    } catch { toast.error(workT("completeFailed")); }
    finally { completingRef.current.delete(key); setCompletingKeys(new Set(completingRef.current)); }
  };
  const markProcessed = (key: string) => {
    setProcessedKeys((current) => new Set(current).add(key));
    if (worklist && canContact && !completedFor(key)) void setCompletion(key, true);
  };
  const advanceAfter = (key: string) => {
    const processed = new Set([...processedKeys, key, ...currentSession.keys.filter(completedFor)]);
    const allowed = new Set(selectableKeys);
    for (const candidate of currentSession.keys) if (!allowed.has(candidate)) processed.add(candidate);
    const next = nextUnprocessedCommunicationKey(currentSession.keys, processed, key) ?? key;
    setActiveId(next);
    const nextRow = currentSession.facts.get(next);
    setActiveContactId(nextRow?.source === "contact" ? nextRow.value.id : null);
  };
  const workPurposeFor = (key: string) => {
    const task = workday?.tasks.find((item) => item.key === key);
    return worklist?.name ?? (task ? workT("taskDue", { time: formatAt(task.dueAt) }) : undefined);
  };
  const leadingSelectionFor = (row: CommunicationRow) => {
    const key = communicationRowKey(row);
    const completed = completedFor(key);
    return <>{selectionEnabled && canOperateRow(row) ? <Checkbox checked={workSelection.selectedKeys.has(key)} onCheckedChange={(checked) => workSelection.toggle(key, checked === true)}
      aria-label={workT("selectRow", { name: nameOf(row) })} onClick={(event) => event.stopPropagation()} /> : null}
      {worklist ? <Button type="button" size="sm" variant="ghost" aria-pressed={completed} className={cn("size-5 shrink-0 p-0", completed ? "bg-blue/10 text-blue" : "text-muted")}
        disabled={!canContact || Boolean(worklist.closedAt) || completingKeys.has(key)} onClick={(event) => { event.stopPropagation(); void setCompletion(key, !completed); }}
        aria-label={workT(completed ? "markPending" : "markComplete")} title={workT(completed ? "completed" : "markComplete")}>
        {completingKeys.has(key) ? <LoaderCircle className="size-3 animate-spin" /> : <Check className="size-3" />}</Button>
        : completed ? <Check className="size-3.5 shrink-0 text-blue" aria-label={workT("completed")} /> : null}</>;
  };
  const selectedVisible = selectableKeys.filter((key) => workSelection.selectedKeys.has(key)).length;
  const updateSessionFact = (row: CommunicationRow) => setWorkSession((current) => current
    ? { ...current, facts: new Map(current.facts).set(communicationRowKey(row), row) } : current);
  const onSaved = (row: InvitationCoordinationRow, input: UpdateInvitationInput) => {
    const savedAt = new Date().toISOString();
    const activity = activities.find((item) => item.id === input.activityId);
    const assessor = assessors.find((item) => item.userId === input.assessorId);
    const value: InvitationCoordinationRow = { ...row, ...input, activityTitle: activity?.title ?? "", activityScheduledAt: activity?.scheduledAt ?? null,
      assessorName: assessor?.displayName ?? "", nextContactAt: input.nextContactAt ?? null, summary: input.note.trim() || row.summary, updatedAt: savedAt,
      events: [{ id: `session-${savedAt}`, fromState: row.state, toState: input.state, channel: input.channel, note: input.note, recordedByName: t("currentOperator"), occurredAt: savedAt }, ...row.events].slice(0, 3) };
    setRowOverrides((current) => ({ ...current, [row.id]: { base: rows.find((original) => original.id === row.id) ?? row, value } }));
    updateSessionFact({ id: row.id, source: "invitation", value });
    markProcessed(`lead:${row.leadId}`);
  };
  const savePost = (row: ActivityEnrollmentContext) => {
    setPostOverrides((current) => ({ ...current, [row.registrationId]: { base: postActivityRows.find((original) => original.registrationId === row.registrationId) ?? row, value: row } }));
    updateSessionFact({ id: `post:${row.registrationId}`, source: "post_activity", value: row });
    markProcessed(`post:${row.registrationId}`);
  };
  const saveContact = (leadId: string, input: LeadContactInput) => {
    endSave(`contact:${leadId}`);
    const lead = leadById.get(leadId);
    if (!lead) return;
    const savedAt = new Date().toISOString();
    const activity = activities.find((item) => item.id === input.invitation?.activityId);
    const assessor = assessors.find((item) => item.userId === input.invitation?.assessorId);
    const updated: LeadPoolRow = {
      ...lead,
      status: deriveLeadContactDestination(input.outcome),
      contactCount: lead.contactCount + 1,
      lastContactAt: savedAt,
      lastContactOutcome: input.outcome,
      lastContactNote: input.note,
      wechatAdded: input.wechatAdded,
      interestLevel: input.interestLevel,
      nextContactAt: input.nextContactAt,
      activeInvitation: input.invitation ? {
        id: `session-${lead.id}`, ...input.invitation, legacyTimeText: "",
        activityTitle: activity?.title ?? "", activityScheduledAt: activity?.scheduledAt ?? null,
        assessorName: assessor?.displayName ?? "", updatedAt: savedAt,
        nextContactAt: input.invitation.nextContactAt ?? input.nextContactAt,
      } : lead.activeInvitation,
    };
    setLeadSession((current) => ({ ...current, overrides: { ...current.overrides, [leadId]: updated } }));
    const savedRow = currentSession.facts.get(`lead:${leadId}`);
    updateSessionFact({ id: `contact:${leadId}`, source: "contact", value: updated,
      ...(savedRow?.source === "contact" && savedRow.previousInvitation ? { previousInvitation: savedRow.previousInvitation } : {}) });
    if (!input.invitation) setRecontactIds((current) => new Set([...current].filter((id) => !rows.some((row) => row.id === id && row.leadId === leadId))));
    markProcessed(`lead:${leadId}`);
    advanceAfter(`lead:${leadId}`);
    router.refresh();
  };
  const saveContactReminder = (leadId: string, nextContactAt: string | null) => {
    const lead = leadById.get(leadId);
    if (!lead) return;
    setLeadSession((current) => ({ ...current, overrides: { ...current.overrides, [leadId]: { ...lead, nextContactAt } } }));
    const savedRow = currentSession.facts.get(`lead:${leadId}`);
    if (savedRow?.source === "contact") updateSessionFact({ ...savedRow, value: { ...lead, nextContactAt } });
    router.refresh();
  };
  const contactPending = (id: string, pending: boolean) => {
    if (pending) beginSave(id);
    else if (savingIdsRef.current.has(id)) endSave(id);
  };
  return <DashboardTableShell>
    <Table className="w-full min-w-[62rem] table-fixed text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
      <colgroup><col style={{ width: "14rem" }} /><col style={{ width: "16rem" }} /><col style={{ width: "24rem" }} /><col style={{ width: "8rem" }} /></colgroup>
      <TableHeader><TableRow>
        <TableHead className="sticky left-0 top-0 z-30 h-9 border-r border-line bg-card px-2"><div className="flex min-w-0 items-center gap-1.5">
          {selectionEnabled ? <Checkbox checked={selectableKeys.length > 0 && selectedVisible === selectableKeys.length ? true : selectedVisible ? "indeterminate" : false}
            disabled={!selectableKeys.length} aria-label={workT("selectVisible")} onCheckedChange={(checked) => workSelection.toggleMany(selectableKeys, checked === true)} /> : null}
          <DashboardTableColumnHeader label={t("leadColumn")} {...table.columnProps("lead")} /></div></TableHead>
        <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={recordsMode ? workT("dayResultColumn") : workspaceT("contactStage")} {...table.columnProps("state")} /></TableHead>
        <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={recordsMode ? workT("dayCommunicationColumn") : workspaceT("communicationInfo")} {...table.columnProps("arrangement")} /></TableHead>
        <TableHead className="sticky top-0 z-20 h-9 bg-card px-2"><DashboardTableColumnHeader label={recordsMode ? workT("occurredAtColumn") : t("updatedColumn")} {...table.columnProps("updated")} /></TableHead>
      </TableRow></TableHeader>
      <TableBody>{visibleRows.map((row) => {
        const canonicalKey = communicationRowKey(row);
        const historicalSummary = historicalSummaryFor(row);
        if (row.source === "contact") {
          const previous = row.previousInvitation;
          return <LeadContactEntryRow key={canonicalKey} lead={row.value} formatAt={formatAt}
            active={activeContactId === row.value.id || activeId === canonicalKey} onActivate={setActiveContactId}
            onSaved={saveContact} onReminderSaved={saveContactReminder}
            activities={activities} assessors={assessors} locale={locale}
            canContact={canContact && !row.value.activeInvitation} canManageIdentity={canManageIdentity} layout="communication"
            expanded={activeId === canonicalKey} onExpandedChange={(open) => changeDetails(canonicalKey, open)}
            leadingSelection={leadingSelectionFor(row)} workPurpose={workPurposeFor(canonicalKey)}
            historicalSummary={historicalSummary} historicalEntryLabel={recordsMode ? workT("newCommunication") : undefined}
            detailsFirst={workMode === "records"}
            onPendingChange={(pending) => contactPending(row.id, pending)}
            rowActions={previous ? <Button type="button" size="sm" variant="ghost" className="h-auto min-h-7 max-w-full whitespace-normal px-1 py-1 text-[11px]" disabled={savingIds.has(row.id)} onClick={() => {
              setRecontactIds((current) => new Set([...current].filter((id) => id !== previous.id)));
              setActiveId(canonicalKey);
            }}>{t("returnToInvitation")}</Button> : undefined}
            detailsExtra={<><CommunicationDaySummary workday={workday} rowKey={canonicalKey} /><InvitationHistory rows={previous ? [previous, ...historyFor(row.value.id, previous.id)] : historyFor(row.value.id)} formatAt={formatAt} />{workMode === "records" ? <p className="text-xs font-medium text-muted">{workT("currentFacts")}</p> : null}</>}
          />;
        }
        const state = row.source === "invitation" ? row.value.state : followupState(row.value);
        const tone = ["confirmed", "completed", "enrolled"].includes(state) ? "healthy" : ["cancelled", "closed", "unreachable"].includes(state) ? "unhealthy" : "attention";
        const laterContact = row.source === "invitation" ? laterContactFor(row.value) : null;
        const nextAt = row.source === "invitation" ? laterContact ? laterContact.nextContactAt : row.value.nextContactAt : row.value.contacts[0]?.nextContactAt;
        const closed = row.source === "invitation" && ["completed", "cancelled"].includes(row.value.state);
        const active = activeId === canonicalKey;
        const detailsId = `communication-details-${canonicalKey}`;
        const rowWorkStep = row.source === "invitation" ? invitationWorkStep(row.value) : null;
        const rowAction = rowWorkStep && rowWorkStep !== "closed" ? t(`workTitle_${rowWorkStep}`) : stateOf(row);
        const rowActionHint = row.source === "invitation"
          ? rowWorkStep === "closed" ? laterContact?.lastContactOutcome ? leadT(`contactOutcome_${laterContact.lastContactOutcome}`) : t(`task_${row.value.state}`)
            : rowWorkStep === "waiting_assessor_response" ? t("workHint_waiting_assessor_response", { assessor: row.value.assessorName || t("assessorPending") })
              : rowWorkStep ? t(`workHint_${rowWorkStep}`) : ""
          : row.value.recommendation || row.value.routeNote;
        return <Fragment key={canonicalKey}>
          <TableRow data-communication-work-key={canonicalKey} ref={(element) => { if (element) rowRefs.current.set(canonicalKey, element); else rowRefs.current.delete(canonicalKey); }}
            tabIndex={0} aria-selected={active} aria-busy={savingIds.has(row.id)} className={cn("cursor-pointer focus:outline-none focus-visible:outline-none focus-visible:bg-blue/10", active && "bg-moon/10 hover:bg-moon/10")}
            onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a,input,textarea,[role='combobox'],[role='checkbox']")) changeDetails(canonicalKey, !active); }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat) return;
              if (event.target === event.currentTarget && event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) { event.preventDefault(); changeDetails(canonicalKey, !active); }
              if (event.key === "Escape" && active) { event.preventDefault(); changeDetails(canonicalKey, false); }
            }}>
            <TableCell className="sticky left-0 z-10 border-r border-line bg-card px-2 py-2" style={active ? { backgroundColor: "color-mix(in srgb, var(--card) 90%, var(--moon))" } : undefined}>
              <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
                {leadingSelectionFor(row)}<Button type="button" size="sm" variant="ghost" className="size-5 shrink-0 p-0" aria-label={nameOf(row)} aria-expanded={active} aria-controls={detailsId} onClick={() => changeDetails(canonicalKey, !active)}>
                  {active ? <ChevronDown className="size-3.5 text-muted" /> : <ChevronRight className="size-3.5 text-muted" />}
                </Button>
                <span className="truncate font-medium text-ink">{nameOf(row)}</span><a href={`tel:${row.value.phone}`} className="font-mono text-[11px] text-ink underline-offset-4 hover:underline">{row.value.phone}</a>
              </div>
              <p className="mt-0.5 truncate pl-7 text-[11px] text-muted">{row.value.gradeText || t("gradePending")}{row.source === "invitation" && row.value.ownerName ? ` · ${row.value.ownerName}` : ""}</p>
            </TableCell>
            <TableCell className="px-2 py-2">{historicalSummary ? historicalSummary.state : <><Badge variant="outline" className={cn("max-w-full truncate", followupToneClasses[tone])}>{rowAction}</Badge><p className="mt-1 truncate text-[11px] text-muted" title={workPurposeFor(canonicalKey) || rowActionHint}>{workPurposeFor(canonicalKey) || rowActionHint}</p></>}</TableCell>
            <TableCell className="px-2 py-2">
              {historicalSummary ? historicalSummary.details : <><div className="flex min-w-0 items-center gap-2"><Badge variant="secondary" className="shrink-0 text-[11px]">{kindOf(row)}</Badge><p className="truncate text-ink" title={arrangementOf(row)}>{arrangementOf(row)}</p></div>
              {noteOf(row) ? <p className="mt-1 truncate text-[11px] text-muted" title={noteOf(row)}>{noteOf(row)}</p> : null}
              {nextAt ? <p className="mt-1 truncate text-[11px] text-rose" title={formatAt(nextAt)}>{t("nextContactReminderScheduled", { time: formatAt(nextAt) })}</p> : null}</>}
              {recordsMode && (row.source === "invitation" || row.value.eligible) ? <p className="mt-1 text-[10px] text-muted">{workT("newCommunication")}</p> : null}
              <div className="mt-1.5">{row.source === "invitation" ? closed && canContact && leadById.has(row.value.leadId) && !leadById.get(row.value.leadId)?.activeInvitation ? <Button type="button" size="sm" variant="secondary" className="h-8 text-xs" onClick={() => {
                setRecontactIds((current) => new Set(current).add(row.id));
                setActiveContactId(row.value.leadId);
                changeDetails(canonicalKey, true);
              }}>{leadT("continueCommunication")}</Button> : <InvitationQuickContact row={row.value} disabled={!canManageInvitation || closed} onSaved={(saved, input) => { onSaved(saved, input); advanceAfter(canonicalKey); }} saving={savingIds.has(row.id)} beginSave={beginSave} endSave={endSave} /> : row.value.eligible ? <PostActivityQuickContact row={row.value} onSaved={(saved) => { savePost(saved); advanceAfter(canonicalKey); }} onDetails={() => changeDetails(canonicalKey, !active)} expanded={active} detailsId={detailsId} /> : null}</div>
            </TableCell>
            <TableCell className="whitespace-nowrap px-2 py-2 text-muted">{historicalSummary ? historicalSummary.updated : formatAt(updatedOf(row))}</TableCell>
          </TableRow>
          <FollowupInlineDetails id={detailsId} open={active} onOpenChange={(open) => changeDetails(canonicalKey, open)} title={nameOf(row)} colSpan={4} pending={savingIds.has(row.id)}>
            <CommunicationDaySummary workday={workday} rowKey={canonicalKey} />
            {recordsMode ? <div className="space-y-1 text-xs"><p className="font-medium text-muted">{workT("currentFacts")}</p><p>{stateOf(row)} · {arrangementOf(row)}</p>{noteOf(row) ? <p className="break-words text-muted">{noteOf(row)}</p> : null}</div> : null}
            {row.source === "invitation" ? <InvitationEditor key={row.id} row={row.value} activities={activities} assessors={assessors} locale={locale} formatAt={formatAt} currentUserId={currentUserId} canManageInvitation={canManageInvitation} onSaved={onSaved} saving={savingIds.has(row.id)} beginSave={beginSave} endSave={endSave} /> : <PostActivityHandoff source={{ registrationId: row.value.registrationId, invitationId: null }} initialContext={row.value} onSaved={savePost} />}
            {laterContact?.lastContactAt ? <p className="mt-2 min-w-0 break-words border-t border-line pt-2 text-xs text-muted">{formatAt(laterContact.lastContactAt)} · {noteOf(row)}</p> : null}
            {row.source === "invitation" ? <InvitationHistory rows={historyFor(row.value.leadId, row.value.id)} formatAt={formatAt} /> : null}
          </FollowupInlineDetails>
        </Fragment>;
      })}{!visibleRows.length ? <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted">{tableT("filteredEmpty")}</TableCell></TableRow> : null}</TableBody>
    </Table>
  </DashboardTableShell>;
}
