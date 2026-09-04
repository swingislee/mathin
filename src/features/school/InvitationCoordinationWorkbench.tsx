"use client";

import { Check, ChevronDown, ChevronRight, Copy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAction } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { DashboardTableColumnHeader, DashboardTableShell } from "./dashboard-page";
import {
  clearInvitationDraftSession,
  InvitationDraftFields,
  invitationDraftSessionKey,
} from "./InvitationDraftFields";
import {
  ASSESSMENT_TIME_ZONE,
  assessmentAvailabilityIntersection,
  assessmentTimeOptionToInstant,
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
import { zonedDateTimeToInstant } from "./schedule";

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

function draftMatchesRow(draft: InvitationDraft, row: InvitationCoordinationRow): boolean {
  return draft.kind === row.kind
    && draft.state === row.state
    && draft.activityId === row.activityId
    && draft.assessorId === row.assessorId
    && sameOptions(draft.parentTimeOptions, row.parentTimeOptions)
    && sameOptions(draft.assessorTimeOptions, row.assessorTimeOptions)
    && draft.scheduledAt === row.scheduledAt
    && draft.locationText === row.locationText;
}

function rowMatchesView(
  row: InvitationCoordinationRow,
  queue: InvitationQueue,
  stage: InvitationCoordinationStage | null,
): boolean {
  if (queue === "confirmed") return row.state === "confirmed";
  if (queue === "waiting_activity") return row.state === "waiting_activity";
  if (queue === "closed") return row.state === "completed" || row.state === "cancelled";
  if (row.state !== "coordinating_time" && row.state !== "awaiting_teacher" && row.state !== "awaiting_parent") {
    return false;
  }
  return !stage || stage === "all" || row.state === stage;
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
}: {
  row: InvitationCoordinationRow;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  formatAt: (value: string) => string;
  currentUserId: string;
  canManageInvitation: boolean;
  onSaved: (row: InvitationCoordinationRow, input: UpdateInvitationInput) => void;
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
  });
  const [channel, setChannel] = useState<InvitationChannel>("wechat");
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const submittedInputRef = useRef<UpdateInvitationInput | null>(null);
  const draftStorageKey = invitationDraftSessionKey("coordination", row.id, row.updatedAt);
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
      default: t("saveFailed"),
    },
    onSuccess: () => {
      const input = submittedInputRef.current;
      if (!input) return;
      submittedInputRef.current = null;
      clearInvitationDraftSession(draftStorageKey);
      setDraft({
        kind: input.kind,
        state: input.state,
        activityId: input.activityId,
        assessorId: input.assessorId,
        parentTimeOptions: input.parentTimeOptions,
        assessorTimeOptions: input.assessorTimeOptions,
        scheduledAt: input.scheduledAt,
        locationText: input.locationText,
      });
      onSaved(row, input);
      setNote("");
      setCancelOpen(false);
      router.refresh();
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
  });
  const pending = updateRun.pending || assessorRun.pending;
  const submitSupport = (nextDraft: InvitationDraft) => {
    const input = { ...nextDraft, channel, note };
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
  const teacherHandoffNeedsSave = dirty || row.state !== "awaiting_teacher" || Boolean(note.trim());
  const candidateNeedsSave = dirty || row.state !== "awaiting_parent" || Boolean(note.trim());

  const supportActionContent = (() => {
    const header = (title: string, hint: string) => (
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 text-[11px] leading-5 text-muted">{hint}</p>
      </div>
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
          <div className="flex flex-wrap gap-1.5">
            {exactSharedOptions.map(({ option, instant }) => (
              <Button key={option} type="button" size="sm" variant="secondary" className="h-8 rounded-lg px-2.5 text-[11px]" disabled={pending} onClick={() => setDraft({ ...draft, scheduledAt: instant })}>
                {formatOption(option)}
              </Button>
            ))}
          </div>
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
            <div className="flex flex-wrap gap-1">
              {exactSharedOptions.map(({ option, instant }) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn("h-7 rounded-lg px-2 text-[10px]", draft.scheduledAt === instant && "bg-moon/35 text-ink")}
                  aria-pressed={draft.scheduledAt === instant}
                  disabled={pending}
                  onClick={() => setDraft({ ...draft, scheduledAt: instant })}
                >
                  {formatOption(option)}
                </Button>
              ))}
            </div>
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
      return (
        <>
          {header(t("workTitle_direct_booking_ready"), t("workHint_direct_booking_ready"))}
          <div className="border-l-2 border-rose pl-3">
            <p className="text-sm font-medium text-ink">{currentArrangement}</p>
          </div>
          <Button type="button" size="sm" className="h-9 w-full" disabled={pending} onClick={() => submitSupport({ ...draft, state: "confirmed" })}>
            {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
            {t("saveDirectBooking")}
          </Button>
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

  return (
    <div className="px-2 py-1">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <InvitationDraftFields
          value={draft}
          activities={activities}
          assessors={assessors}
          locale={locale}
          disabled={pending || (!assessorEditing && workStep === "confirmed")}
          allowNone={false}
          variant="workflow"
          editingScope={assessorEditing ? "assessor" : "full"}
          draftStorageKey={draftStorageKey}
          onChange={(value) => { if (value) setDraft(value); }}
        />

        <section className="space-y-3 border-line xl:border-l xl:pl-5">
          {assessorEditing ? (
            <>
              <p className="text-sm font-medium text-ink">{t("assessorAvailabilityTitle")}</p>
              <p className="text-[11px] leading-5 text-muted">{t("assessorAvailabilityHint")}</p>
              <p className="text-[11px] text-ink">{sharedOptions.length > 0
                ? t("assessorOverlapFound", { count: sharedOptions.length })
                : t("assessorOverlapPending")}</p>
              <Button
                type="button"
                size="sm"
                className="h-9 w-full"
                disabled={pending || sameOptions(draft.assessorTimeOptions, row.assessorTimeOptions)}
                onClick={() => assessorRun.run(row.id, draft.assessorTimeOptions)}
              >
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />}
                {sharedOptions.length > 0 ? t("saveAssessorAvailabilityWithOverlap") : t("saveAssessorAvailability")}
              </Button>
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{t("currentWorkAction")}</p>
              {supportActionContent}
              {workStep !== "confirmed" ? (
                <div className="space-y-2 border-t border-line pt-3">
                  <Label htmlFor={`invitation-note-${row.id}`} className="text-[11px] text-muted">{t("communicationOptional")}</Label>
                  <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("channelLabel")}>
                    {CHANNELS.map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn("h-7 min-w-0 rounded-lg px-1 text-[10px]", channel === value && "bg-moon/35 text-ink")}
                        aria-pressed={channel === value}
                        disabled={pending}
                        onClick={() => setChannel(value)}
                      >
                        {channel === value ? <Check className="size-3" /> : null}
                        <span className="truncate">{t(`channel_${value}`)}</span>
                      </Button>
                    ))}
                  </div>
                  <Textarea
                    id={`invitation-note-${row.id}`}
                    value={note}
                    disabled={pending}
                    rows={1}
                    maxLength={2000}
                    className="min-h-9 resize-y rounded-xl px-3 py-2 text-xs"
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

      <div className="mt-4 grid gap-2 border-t border-line pt-3 md:grid-cols-[8rem_minmax(0,1fr)]">
        <p className="text-[11px] font-medium text-ink">{t("recentHistory")}</p>
        {row.events.length > 0 ? (
          <div className="grid gap-1">
            {row.events.map((event) => (
              <p key={event.id} className="truncate text-[11px] leading-4 text-muted" title={event.note || undefined}>
                {formatAt(event.occurredAt)} · {event.recordedByName || t("unknownOperator")} · {t(`channel_${event.channel}`)} · {t(`state_${event.toState}`)}
                {event.note ? ` · ${event.note}` : ""}
              </p>
            ))}
          </div>
        ) : <p className="text-[11px] text-muted">{t("noHistory")}</p>}
      </div>
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

export function InvitationCoordinationWorkbench({
  rows,
  activities,
  assessors,
  locale,
  queue,
  coordinationStage,
  stageCounts,
  searchQuery,
  currentUserId,
  canManageInvitation,
}: {
  rows: InvitationCoordinationRow[];
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  queue: InvitationQueue;
  coordinationStage: InvitationCoordinationStage | null;
  stageCounts: InvitationQueueCounts["stages"];
  searchQuery?: string;
  currentUserId: string;
  canManageInvitation: boolean;
}) {
  const t = useTranslations("school.invitations");
  const router = useRouter();
  const [rowOverrides, setRowOverrides] = useState<Record<string, InvitationCoordinationRow>>({});
  const [activeId, setActiveId] = useState<string | null>(() => rows[0]?.id ?? null);
  const sessionRows = rows
    .map((row) => {
      const override = rowOverrides[row.id];
      return override && override.updatedAt >= row.updatedAt ? override : row;
    })
    .filter((row) => rowMatchesView(row, queue, coordinationStage));
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const formatAt = (value: string) => dateTimeFormatter.format(new Date(value));
  const replaceCoordinationStage = (value: string | undefined) => {
    const query = new URLSearchParams();
    if (value) query.set("stage", value);
    if (searchQuery) query.set("q", searchQuery);
    const qs = query.toString();
    router.replace(`/dashboard/invitations${qs ? `?${qs}` : ""}`);
  };
  const stageColumnLabel = coordinationStage && coordinationStage !== "all"
    ? `${t("stateColumn")} · ${t(`queue_${coordinationStage}`)}`
    : t("stateColumn");
  const onSaved = (row: InvitationCoordinationRow, input: UpdateInvitationInput) => {
    const savedAt = new Date().toISOString();
    const activity = input.activityId ? activities.find((item) => item.id === input.activityId) : undefined;
    const assessor = input.assessorId ? assessors.find((item) => item.userId === input.assessorId) : undefined;
    setRowOverrides((current) => {
      const item = current[row.id] ?? row;
      return { ...current, [row.id]: {
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
      } };
    });
  };

  return (
    <DashboardTableShell>
      <Table className="w-full min-w-[62rem] text-xs" containerClassName="max-h-[calc(100dvh-13rem)] overflow-auto">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 top-0 z-30 h-9 min-w-56 border-r border-line bg-card px-2">{t("leadColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-64 bg-card px-2">
              {coordinationStage ? (
                <DashboardTableColumnHeader
                  label={stageColumnLabel}
                  labels={{
                    menu: t("stageFilterMenu"),
                    scope: t("stageFilterScope"),
                    filter: t("stageFilter"),
                    allValues: t("stageFilterAll", { count: stageCounts.all }),
                    clear: t("stageFilterClear"),
                  }}
                  filterValue={coordinationStage === "all" ? undefined : coordinationStage}
                  filterOptions={(["coordinating_time", "awaiting_teacher", "awaiting_parent"] as const).map((stage) => ({
                    value: stage,
                    label: t("stageFilterOption", { label: t(`queue_${stage}`), count: stageCounts[stage] }),
                  }))}
                  onFilterChange={replaceCoordinationStage}
                  onClear={() => replaceCoordinationStage(undefined)}
                />
              ) : t("stateColumn")}
            </TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-96 bg-card px-2">{t("arrangementColumn")}</TableHead>
            <TableHead className="sticky top-0 z-20 h-9 min-w-32 bg-card px-2">{t("updatedColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessionRows.map((row) => {
            const closed = row.state === "completed" || row.state === "cancelled";
            const active = !closed && activeId === row.id;
            const rowWorkStep = invitationWorkStep(row);
            const rowAction = rowWorkStep === "closed"
              ? t(`state_${row.state}`)
              : t(`workTitle_${rowWorkStep}`);
            const rowActionHint = rowWorkStep === "closed"
              ? t(`task_${row.state}`)
              : t(`workHint_${rowWorkStep}`);
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
                  <TableCell className="max-w-[22rem] px-2 py-2">
                    <Badge variant="outline" className="border-moon/60 bg-moon/15">{rowAction}</Badge>
                    <p className="mt-1 truncate text-[11px] text-muted" title={rowActionHint}>{rowActionHint}</p>
                  </TableCell>
                  <TableCell className="max-w-[38rem] px-2 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge variant="secondary" className="shrink-0 text-[11px]">{t(`kind_${row.kind}`)}</Badge>
                      <p className="truncate text-ink" title={arrangementText(row, t, formatAt)}>{arrangementText(row, t, formatAt)}</p>
                    </div>
                    {row.summary ? <p className="mt-1 truncate text-[11px] text-muted" title={row.summary}>{row.summary}</p> : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap px-2 py-2 text-muted">{formatAt(row.updatedAt)}</TableCell>
                </TableRow>
                {active ? (
                  <TableRow className="bg-moon/5 hover:bg-moon/5">
                    <TableCell colSpan={4} className="p-3">
                      <InvitationEditor
                        row={row}
                        activities={activities}
                        assessors={assessors}
                        locale={locale}
                        formatAt={formatAt}
                        currentUserId={currentUserId}
                        canManageInvitation={canManageInvitation}
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
