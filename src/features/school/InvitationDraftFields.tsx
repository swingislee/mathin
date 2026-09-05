"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { AssessmentAvailabilityGrid } from "./AssessmentAvailabilityGrid";
import {
  defaultInvitationState,
  INVITATION_KINDS,
  INVITATION_STATES,
  invitationCanHaveNextContactReminder,
  invitationDraftIsComplete,
  invitationStatesForKind,
  normalizeAssessmentTimeOptions,
  selectInvitationProgress,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
  type InvitationKind,
  type InvitationState,
} from "./invitation-contract";
import { NextContactReminderField } from "./NextContactReminderField";

interface StoredInvitationDrafts {
  version: 1;
  selectedKind: InvitationKind | null;
  drafts: Partial<Record<InvitationKind, InvitationDraft>>;
}

const ASSESSMENT_PROGRESS_STATES = invitationStatesForKind("assessment_1v1");

interface InvitationShortcutEvent {
  key: string;
  repeat: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

export function invitationDraftSessionKey(
  scope: "contact" | "coordination",
  recordId: string,
  revision: string,
): string {
  return `mathin:school:invitation-draft:v1:${scope}:${recordId}:${revision}`;
}

export function clearInvitationDraftSession(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 浏览器关闭会话存储时仍保留正常编辑能力。
  }
}

function parseStoredDraft(value: unknown): InvitationDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (!INVITATION_KINDS.includes(draft.kind as InvitationKind)) return null;
  if (!INVITATION_STATES.includes(draft.state as InvitationDraft["state"])) return null;
  if (draft.activityId !== null && typeof draft.activityId !== "string") return null;
  if (draft.assessorId !== null && typeof draft.assessorId !== "string") return null;
  if (!Array.isArray(draft.parentTimeOptions) || !draft.parentTimeOptions.every((item) => typeof item === "string")) return null;
  if (!Array.isArray(draft.assessorTimeOptions) || !draft.assessorTimeOptions.every((item) => typeof item === "string")) return null;
  if (draft.scheduledAt !== null && typeof draft.scheduledAt !== "string") return null;
  if (typeof draft.locationText !== "string") return null;
  if (draft.nextContactAt !== undefined
      && draft.nextContactAt !== null
      && typeof draft.nextContactAt !== "string") return null;
  return {
    kind: draft.kind as InvitationKind,
    state: draft.state as InvitationDraft["state"],
    activityId: draft.activityId as string | null,
    assessorId: draft.assessorId as string | null,
    parentTimeOptions: normalizeAssessmentTimeOptions(draft.parentTimeOptions),
    assessorTimeOptions: normalizeAssessmentTimeOptions(draft.assessorTimeOptions),
    scheduledAt: draft.scheduledAt as string | null,
    locationText: draft.locationText,
    nextContactAt: typeof draft.nextContactAt === "string" ? draft.nextContactAt : null,
  };
}

function readStoredDrafts(key: string): StoredInvitationDrafts | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || value.version !== 1 || !value.drafts || typeof value.drafts !== "object") return null;
    const selectedKind = value.selectedKind === null || INVITATION_KINDS.includes(value.selectedKind as InvitationKind)
      ? value.selectedKind as InvitationKind | null
      : null;
    const drafts = Object.fromEntries(INVITATION_KINDS.flatMap((kind) => {
      const draft = parseStoredDraft((value.drafts as Record<string, unknown>)[kind]);
      return draft?.kind === kind ? [[kind, draft]] : [];
    })) as Partial<Record<InvitationKind, InvitationDraft>>;
    return { version: 1, selectedKind, drafts };
  } catch {
    clearInvitationDraftSession(key);
    return null;
  }
}

function writeStoredDrafts(key: string, value: StoredInvitationDrafts): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 浏览器关闭会话存储时仍保留正常编辑能力。
  }
}

function blankDraft(kind: InvitationKind): InvitationDraft {
  return {
    kind,
    state: defaultInvitationState(kind),
    activityId: null,
    assessorId: null,
    parentTimeOptions: [],
    assessorTimeOptions: [],
    scheduledAt: null,
    locationText: "",
    nextContactAt: null,
  };
}

export function InvitationDraftFields({
  value,
  activities,
  assessors,
  locale,
  disabled = false,
  allowNone = true,
  variant = "inline",
  editingScope = "full",
  draftStorageKey,
  onChange,
  onConfirmedReady,
}: {
  value: InvitationDraft | null;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  disabled?: boolean;
  allowNone?: boolean;
  variant?: "inline" | "workflow";
  editingScope?: "full" | "assessor";
  draftStorageKey?: string;
  onChange: (value: InvitationDraft | null) => void;
  onConfirmedReady?: (value: InvitationDraft) => void;
}) {
  const t = useTranslations("school.invitations");
  const reminderId = useId();
  const workflow = variant === "workflow";
  const draftCacheRef = useRef<Partial<Record<InvitationKind, InvitationDraft>>>(
    value ? { [value.kind]: value } : {},
  );
  const onChangeRef = useRef(onChange);
  const onConfirmedReadyRef = useRef(onConfirmedReady);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onConfirmedReadyRef.current = onConfirmedReady;
  }, [onConfirmedReady]);
  useEffect(() => {
    if (!draftStorageKey) return;
    const stored = readStoredDrafts(draftStorageKey);
    if (!stored) return;
    draftCacheRef.current = { ...draftCacheRef.current, ...stored.drafts };
    const restored = stored.selectedKind ? stored.drafts[stored.selectedKind] ?? null : null;
    if (restored || allowNone) {
      onChangeRef.current(restored);
      if (restored?.kind === "assessment_1v1" && restored.state === "confirmed" && invitationDraftIsComplete(restored)) {
        onConfirmedReadyRef.current?.(restored);
      }
    }
  }, [allowNone, draftStorageKey]);
  const persistDrafts = useCallback((selectedKind: InvitationKind | null) => {
    if (!draftStorageKey) return;
    writeStoredDrafts(draftStorageKey, {
      version: 1,
      selectedKind,
      drafts: draftCacheRef.current,
    });
  }, [draftStorageKey]);
  const emit = useCallback((next: InvitationDraft) => {
    draftCacheRef.current[next.kind] = next;
    persistDrafts(next.kind);
    onChangeRef.current(next);
    if (next.kind === "assessment_1v1" && next.state === "confirmed" && invitationDraftIsComplete(next)) {
      onConfirmedReadyRef.current?.(next);
    }
  }, [persistDrafts]);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const chooseKind = (kind: InvitationKind | null) => {
    if (value) draftCacheRef.current[value.kind] = value;
    if (!kind) {
      persistDrafts(null);
      onChange(null);
      return;
    }
    const next = value?.kind === kind ? value : draftCacheRef.current[kind] ?? blankDraft(kind);
    emit(next);
  };
  const update = <K extends keyof InvitationDraft>(key: K, next: InvitationDraft[K]) => {
    if (!value) return;
    emit({ ...value, [key]: next });
  };
  const stateChoices = value?.kind === "assessment_1v1"
    ? ASSESSMENT_PROGRESS_STATES
    : [];
  const chooseState = useCallback((state: InvitationState) => {
    if (!value) return;
    emit(selectInvitationProgress(value, state));
  }, [emit, value]);
  const handleStateShortcut = useCallback((event: InvitationShortcutEvent) => {
    if (
      !value
      || value.kind !== "assessment_1v1"
      || disabled
      || editingScope === "assessor"
      || event.repeat
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) return;
    const target = event.target;
    if (
      target instanceof HTMLElement
      && target.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu']")
    ) return;
    const state = ASSESSMENT_PROGRESS_STATES[Number(event.key) - 1];
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    chooseState(state);
  }, [chooseState, disabled, editingScope, value]);
  const selectedActivity = value?.activityId
    ? activities.find((activity) => activity.id === value.activityId)
    : undefined;

  const kindChoices = <FollowupChoice className={workflow ? "grid w-full min-w-0 max-w-full grid-cols-3 gap-1.5 @[44rem]/invitation-draft:grid-cols-1 [&>button]:justify-start" : "flex min-w-0 max-w-full flex-wrap items-center gap-1"} label={t("kindLabel")} value={value?.kind ?? "none"}
    disabled={disabled || editingScope === "assessor"} onValueChange={(kind) => chooseKind(kind === "none" ? null : kind as InvitationKind)}
    options={[...(allowNone ? [{ value: "none", label: t("kind_none"), tone: "neutral" as const }] : []),
      ...INVITATION_KINDS.map((kind) => ({ value: kind, label: t(`kind_${kind}`), tone: kind === "waiting_activity" ? "attention" as const : "healthy" as const }))]} />;

  const arrangementFields = value?.kind === "assessment_1v1" ? (
    <div className="grid min-w-0 gap-3 @[25rem]/invitation-fields:grid-cols-2 @[44rem]/invitation-fields:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1.5 @[25rem]/invitation-fields:col-span-2 @[44rem]/invitation-fields:col-span-1 [&>button]:min-w-0 [&>button]:max-w-full">
        {workflow ? <Label className="text-[11px] text-muted">{t("timeLabel")}</Label> : null}
        <AssessmentAvailabilityGrid
          value={value}
          locale={locale}
          disabled={disabled}
          editableSide={editingScope === "assessor" ? "assessor" : "both"}
          onChange={(next) => emit(next)}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        {workflow ? <Label htmlFor="invitation-assessor" className="text-[11px] text-muted">{t("assessorLabel")}</Label> : null}
        <FollowupChoice className="w-full min-w-0 max-w-full" label={t("assessorLabel")} value={value.assessorId ?? "none"}
          disabled={disabled || editingScope === "assessor"} options={[{ value: "none", label: t("assessorPending") }, ...assessors.map((assessor) => ({ value: assessor.userId, label: assessor.displayName }))]}
          onValueChange={(assessorId) => {
            const nextAssessorId = assessorId === "none" ? null : assessorId;
            emit({ ...value, assessorId: nextAssessorId,
              assessorTimeOptions: nextAssessorId === value.assessorId ? value.assessorTimeOptions : [],
              scheduledAt: nextAssessorId === value.assessorId ? value.scheduledAt : null });
          }} />
      </div>
      <div className="min-w-0 space-y-1.5">
        {workflow ? <Label htmlFor="invitation-location" className="text-[11px] text-muted">{t("locationLabel")}</Label> : null}
        <Input
          id={workflow ? "invitation-location" : undefined}
          value={value.locationText}
          disabled={disabled || editingScope === "assessor"}
          maxLength={200}
          className="h-8 min-w-0 max-w-full text-xs"
          placeholder={t("locationPlaceholder")}
          aria-label={t("locationLabel")}
          onChange={(event) => update("locationText", event.target.value)}
        />
      </div>
    </div>
  ) : value?.kind === "activity" ? (
    <div className="grid min-w-0 gap-3 @[30rem]/invitation-fields:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1.5">
        {workflow ? <Label htmlFor="invitation-activity" className="text-[11px] text-muted">{t("activityLabel")}</Label> : null}
        <FollowupChoice className="w-full min-w-0 max-w-full" label={t("activityLabel")} value={value.activityId ?? ""} disabled={disabled || activities.length === 0}
          options={activities.map((activity) => ({ value: activity.id, label: `${activity.title} · ${dateTimeFormatter.format(new Date(activity.scheduledAt))}` }))}
          onValueChange={(activityId) => { const activity = activities.find((item) => item.id === activityId); emit({ ...value, activityId, locationText: activity?.location ?? value.locationText }); }} />
      </div>
      <div className="min-w-0 space-y-1.5">
        {workflow ? <Label htmlFor="invitation-activity-location" className="text-[11px] text-muted">{t("locationLabel")}</Label> : null}
        <Input
          id={workflow ? "invitation-activity-location" : undefined}
          value={value.locationText}
          disabled={disabled}
          maxLength={200}
          className="h-8 min-w-0 max-w-full text-xs"
          placeholder={t("locationPlaceholder")}
          aria-label={t("locationLabel")}
          onChange={(event) => update("locationText", event.target.value)}
        />
      </div>
      {selectedActivity ? (
        <p className="min-w-0 break-words text-[11px] text-muted @[30rem]/invitation-fields:col-span-2">
          {dateTimeFormatter.format(new Date(selectedActivity.scheduledAt))}
          {selectedActivity.location ? ` · ${selectedActivity.location}` : ""}
        </p>
      ) : null}
    </div>
  ) : value?.kind === "waiting_activity" && !workflow ? (
    <p className="text-[11px] leading-4 text-muted">{t("waitingActivityHint")}</p>
  ) : null;

  const stateControls = value?.kind === "assessment_1v1" ? <FollowupChoice className="w-full min-w-0 max-w-full" label={t("stateLabel")} value={value.state}
    disabled={disabled || editingScope === "assessor"} onValueChange={(state) => chooseState(state as InvitationState)}
    options={stateChoices.map((state, index) => ({ value: state, label: `${t(`state_${state}`)} · ${index + 1}`, tone: state === "confirmed" ? "healthy" : "attention" }))} /> : null;

  return (
    <div
      className="@container/invitation-draft min-w-0 max-w-full"
      data-testid="invitation-draft-fields"
      onKeyDownCapture={handleStateShortcut}
    >
      <div className={cn("grid min-w-0 gap-3", workflow && "@[44rem]/invitation-draft:grid-cols-[12rem_minmax(0,1fr)]")}>
      <section className="min-w-0">
        {workflow ? (
          <p className="mb-2 text-[11px] font-medium text-muted">{t("kindLabel")}</p>
        ) : null}
        {kindChoices}
      </section>

      {value ? (
        <section className={cn("@container/invitation-fields min-w-0 space-y-3", workflow && "border-line @[44rem]/invitation-draft:border-l @[44rem]/invitation-draft:pl-4")}>
          {stateControls}
          {arrangementFields}

          {invitationCanHaveNextContactReminder(value) && editingScope !== "assessor" ? (
            <NextContactReminderField
              id={`invitation-next-contact-${reminderId}`}
              value={value.nextContactAt}
              disabled={disabled}
              className="w-full min-w-0 max-w-sm [&>button]:min-w-0 [&>button]:max-w-full"
              onChange={(nextContactAt) => update("nextContactAt", nextContactAt)}
            />
          ) : null}

          {!workflow && !invitationDraftIsComplete(value) ? (
            <p className="text-[11px] leading-4 text-amber-700" role="status">{t("draftIncomplete")}</p>
          ) : null}
        </section>
      ) : null}
      </div>
    </div>
  );
}
