"use client";

import { Check, Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
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
  showReminder = true,
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
  showReminder?: boolean;
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
  const previousValueRef = useRef(value);
  useEffect(() => {
    if (previousValueRef.current === value) return;
    previousValueRef.current = value;
    // 备注栏中的提醒同样属于当前邀约草稿，随受控值更新保持会话暂存。
    if (!value || draftCacheRef.current[value.kind]?.nextContactAt === value.nextContactAt) return;
    draftCacheRef.current[value.kind] = value;
    persistDrafts(value.kind);
  }, [persistDrafts, value]);
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
  const selectedStateIndex = value ? stateChoices.indexOf(value.state) : -1;
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

  // 保留圆点选择；笔记本宽度将类型横排，宽工作区才展开左侧类型栏。
  const kindChoices = (
    <div
      className={cn(workflow
        ? "grid min-w-0 grid-cols-2 gap-1.5 @[28rem]/invitation-draft:grid-cols-3 @[48rem]/invitation-draft:grid-cols-1"
        : "flex min-w-0 flex-wrap items-center gap-1")}
      role="group"
      aria-label={t("kindLabel")}
    >
      {allowNone ? (
        <Button
          type="button"
          size="sm"
          variant={workflow ? "ghost" : "secondary"}
          className={cn(
            "h-auto min-h-9 min-w-0 justify-start gap-2 whitespace-normal text-left text-xs leading-5",
            workflow ? "rounded-lg px-3 py-2" : "px-2.5 py-1",
            !value && "bg-leaf/25 text-ink",
          )}
          disabled={disabled || editingScope === "assessor"}
          aria-pressed={!value}
          onClick={() => chooseKind(null)}
        >
          <span aria-hidden="true" className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border",
            !value ? "border-leaf-deep bg-leaf text-ink" : "border-line text-muted",
          )}>
            {!value ? <Check className="size-3" /> : null}
          </span>
          {t("kind_none")}
        </Button>
      ) : null}
      {INVITATION_KINDS.map((kind) => {
        const selected = value?.kind === kind;
        return (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={workflow ? "ghost" : "secondary"}
            className={cn(
              "h-auto min-h-9 min-w-0 justify-start gap-2 whitespace-normal text-left text-xs leading-5",
              workflow ? "rounded-lg px-3 py-2" : "px-2.5 py-1",
              selected && "bg-leaf/25 text-ink",
            )}
            disabled={disabled || editingScope === "assessor"}
            aria-pressed={selected}
            onClick={() => chooseKind(kind)}
          >
            <span aria-hidden="true" className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border",
              selected ? "border-leaf-deep bg-leaf text-ink" : "border-line text-muted",
            )}>
              {selected ? <Check className="size-3" /> : null}
            </span>
            {t(`kind_${kind}`)}
          </Button>
        );
      })}
    </div>
  );

  const arrangementFields = value?.kind === "assessment_1v1" ? (
    <div className="grid min-w-0 items-start gap-3 @[25rem]/invitation-fields:grid-cols-2 @[34rem]/invitation-fields:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1.5 @[25rem]/invitation-fields:col-span-2 @[34rem]/invitation-fields:col-span-1 [&>button]:min-w-0 [&>button]:max-w-full">
        <p className="text-xs text-muted">{t("timeLabel")}</p>
        <AssessmentAvailabilityGrid
          value={value}
          locale={locale}
          disabled={disabled}
          editableSide={editingScope === "assessor" ? "assessor" : "both"}
          onChange={(next) => emit(next)}
        />
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs text-muted">{t("assessorLabel")}</p>
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
        <Label htmlFor={`invitation-location-${reminderId}`} className="text-xs text-muted">{t("locationLabel")}</Label>
        <Input
          id={`invitation-location-${reminderId}`}
          value={value.locationText}
          disabled={disabled || editingScope === "assessor"}
          maxLength={200}
          className="h-9 min-w-0 max-w-full text-xs"
          placeholder={t("locationPlaceholder")}
          aria-label={t("locationLabel")}
          onChange={(event) => update("locationText", event.target.value)}
        />
      </div>
    </div>
  ) : value?.kind === "activity" ? (
    <div className="grid min-w-0 gap-3 @[30rem]/invitation-fields:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs text-muted">{t("activityLabel")}</p>
        <FollowupChoice className="w-full min-w-0 max-w-full" label={t("activityLabel")} value={value.activityId ?? ""} disabled={disabled || activities.length === 0}
          options={activities.map((activity) => ({ value: activity.id, label: `${activity.title} · ${dateTimeFormatter.format(new Date(activity.scheduledAt))}` }))}
          onValueChange={(activityId) => { const activity = activities.find((item) => item.id === activityId); emit({ ...value, activityId, locationText: activity?.location ?? value.locationText }); }} />
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`invitation-activity-location-${reminderId}`} className="text-xs text-muted">{t("locationLabel")}</Label>
        <Input
          id={`invitation-activity-location-${reminderId}`}
          value={value.locationText}
          disabled={disabled}
          maxLength={200}
          className="h-9 min-w-0 max-w-full text-xs"
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

  const stateControls = value?.kind === "assessment_1v1" ? (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-ink">{t("stateLabel")}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <Keyboard className="size-3 shrink-0 text-ink" aria-hidden="true" />
          <span>{t("stateManualHint")}</span>
        </p>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("stateLabel")} aria-keyshortcuts="1 2 3 4">
        {stateChoices.map((state, index) => {
          const selected = value.state === state;
          const passed = index < selectedStateIndex;
          return (
            <Button
              key={state}
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-auto min-h-11 min-w-0 flex-col justify-start gap-1 whitespace-normal rounded-lg px-1.5 py-1.5 text-center text-xs leading-5",
                passed && "bg-leaf/10 text-ink",
                selected && "bg-[color-mix(in_srgb,var(--moon)_55%,var(--card))] text-ink",
              )}
              disabled={disabled || editingScope === "assessor"}
              aria-pressed={selected}
              aria-current={selected ? "step" : undefined}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => chooseState(state)}
            >
              <span aria-hidden="true" className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                selected ? "border-crater bg-moon text-ink"
                  : passed ? "border-leaf-deep bg-leaf/50 text-ink"
                    : "border-line text-muted",
              )}>
                {passed ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="w-full">{t(`state_${state}`)}</span>
            </Button>
          );
        })}
      </div>
      <p className="border-l-2 border-moon pl-3 text-[11px] leading-5 text-ink">
        {t(`task_${value.state}`)}
      </p>
    </div>
  ) : null;

  return (
    <div
      className="@container/invitation-draft min-w-0 max-w-full"
      data-testid="invitation-draft-fields"
      onKeyDownCapture={handleStateShortcut}
    >
      <div className={cn("grid min-w-0 gap-3", workflow && "@[48rem]/invitation-draft:grid-cols-[10rem_minmax(0,1fr)]")}>
      <section className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-ink">{t("kindLabel")}</p>
        {kindChoices}
      </section>

      {value ? (
        <section className={cn("@container/invitation-fields min-w-0 space-y-3", workflow && "border-line @[48rem]/invitation-draft:border-l @[48rem]/invitation-draft:pl-4")}>
          {stateControls}
          {arrangementFields}

          {showReminder && invitationCanHaveNextContactReminder(value) && editingScope !== "assessor" ? (
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
