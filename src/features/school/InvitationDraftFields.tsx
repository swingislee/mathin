"use client";

import { Check, Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssessmentAvailabilityGrid } from "./AssessmentAvailabilityGrid";
import {
  defaultInvitationState,
  INVITATION_KINDS,
  INVITATION_STATES,
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
  return {
    kind: draft.kind as InvitationKind,
    state: draft.state as InvitationDraft["state"],
    activityId: draft.activityId as string | null,
    assessorId: draft.assessorId as string | null,
    parentTimeOptions: normalizeAssessmentTimeOptions(draft.parentTimeOptions),
    assessorTimeOptions: normalizeAssessmentTimeOptions(draft.assessorTimeOptions),
    scheduledAt: draft.scheduledAt as string | null,
    locationText: draft.locationText,
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
}) {
  const t = useTranslations("school.invitations");
  const workflow = variant === "workflow";
  const draftCacheRef = useRef<Partial<Record<InvitationKind, InvitationDraft>>>(
    value ? { [value.kind]: value } : {},
  );
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!draftStorageKey) return;
    const stored = readStoredDrafts(draftStorageKey);
    if (!stored) return;
    draftCacheRef.current = { ...draftCacheRef.current, ...stored.drafts };
    const restored = stored.selectedKind ? stored.drafts[stored.selectedKind] ?? null : null;
    if (restored || allowNone) onChangeRef.current(restored);
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
      && target.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='dialog'], [role='listbox'], [role='menu']")
    ) return;
    const state = ASSESSMENT_PROGRESS_STATES[Number(event.key) - 1];
    if (!state) return;
    event.preventDefault();
    event.stopPropagation();
    chooseState(state);
  }, [chooseState, disabled, editingScope, value]);
  useEffect(() => {
    if (!workflow) return;
    const listener = (event: KeyboardEvent) => handleStateShortcut(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [handleStateShortcut, workflow]);
  const selectedActivity = value?.activityId
    ? activities.find((activity) => activity.id === value.activityId)
    : undefined;

  const kindChoices = (
    <div
      className={cn(workflow ? "grid gap-1.5" : "flex min-w-0 flex-wrap items-center gap-1")}
      role="group"
      aria-label={t("kindLabel")}
    >
      {!workflow ? <span className="mr-1 text-[11px] text-muted">{t("kindLabel")}</span> : null}
      {allowNone ? (
        <Button
          type="button"
          size="sm"
          variant={workflow ? "ghost" : "secondary"}
          className={cn(
            workflow ? "h-9 justify-start rounded-lg px-3 text-xs" : "h-7 px-2.5 text-[11px]",
            !value && (workflow ? "bg-leaf/25 text-ink" : "border-leaf-deep bg-leaf/60 text-ink"),
          )}
          disabled={disabled || editingScope === "assessor"}
          aria-pressed={!value}
          onClick={() => chooseKind(null)}
        >
          <span className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
            !value ? "border-leaf-deep bg-leaf text-ink" : "border-line text-muted",
          )}>
            {!value ? <Check className="size-3" /> : null}
          </span>
          {t("kind_none")}
        </Button>
      ) : null}
      {(["assessment_1v1", "activity", "waiting_activity"] as const).map((kind) => {
        const selected = value?.kind === kind;
        return (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={workflow ? "ghost" : "secondary"}
            className={cn(
              workflow ? "h-9 justify-start rounded-lg px-3 text-xs" : "h-7 px-2.5 text-[11px]",
              selected && (workflow ? "bg-leaf/25 text-ink" : "border-leaf-deep bg-leaf/60 text-ink"),
            )}
            disabled={disabled || editingScope === "assessor"}
            aria-pressed={selected}
            onClick={() => chooseKind(kind)}
          >
            {workflow ? (
              <span className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
                selected ? "border-leaf-deep bg-leaf text-ink" : "border-line text-muted",
              )}>
                {selected ? <Check className="size-3" /> : null}
              </span>
            ) : selected ? <Check className="size-3" /> : null}
            {t(`kind_${kind}`)}
          </Button>
        );
      })}
    </div>
  );

  const arrangementFields = value?.kind === "assessment_1v1" ? (
    <div className="grid gap-2 md:grid-cols-[minmax(18rem,1.5fr)_minmax(11rem,0.75fr)_minmax(11rem,0.75fr)]">
      <div className="space-y-1.5">
        {workflow ? <Label className="text-[11px] text-muted">{t("timeLabel")}</Label> : null}
        <AssessmentAvailabilityGrid
          value={value}
          locale={locale}
          disabled={disabled}
          editableSide={editingScope === "assessor" ? "assessor" : "both"}
          onChange={(next) => emit(next)}
        />
      </div>
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-assessor" className="text-[11px] text-muted">{t("assessorLabel")}</Label> : null}
        <Select
          value={value.assessorId ?? "none"}
          disabled={disabled || editingScope === "assessor"}
          onValueChange={(assessorId) => {
            if (!value) return;
            const nextAssessorId = assessorId === "none" ? null : assessorId;
            emit({
              ...value,
              assessorId: nextAssessorId,
              assessorTimeOptions: nextAssessorId === value.assessorId ? value.assessorTimeOptions : [],
              scheduledAt: nextAssessorId === value.assessorId ? value.scheduledAt : null,
            });
          }}
        >
          <SelectTrigger id={workflow ? "invitation-assessor" : undefined} className="h-8 text-xs" aria-label={t("assessorLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("assessorPending")}</SelectItem>
            {assessors.map((assessor) => (
              <SelectItem key={assessor.userId} value={assessor.userId}>{assessor.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-location" className="text-[11px] text-muted">{t("locationLabel")}</Label> : null}
        <Input
          id={workflow ? "invitation-location" : undefined}
          value={value.locationText}
          disabled={disabled || editingScope === "assessor"}
          maxLength={200}
          className="h-8 text-xs"
          placeholder={t("locationPlaceholder")}
          aria-label={t("locationLabel")}
          onChange={(event) => update("locationText", event.target.value)}
        />
      </div>
    </div>
  ) : value?.kind === "activity" ? (
    <div className="grid gap-2 md:grid-cols-[minmax(18rem,1fr)_minmax(12rem,1fr)]">
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-activity" className="text-[11px] text-muted">{t("activityLabel")}</Label> : null}
        <Select
          value={value.activityId ?? "none"}
          disabled={disabled || activities.length === 0}
          onValueChange={(activityId) => {
            const activity = activities.find((item) => item.id === activityId);
            emit({
              ...value,
              activityId,
              locationText: activity?.location ?? value.locationText,
            });
          }}
        >
          <SelectTrigger id={workflow ? "invitation-activity" : undefined} className="h-8 text-xs" aria-label={t("activityLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none" disabled>{activities.length > 0 ? t("activityPending") : t("activityEmpty")}</SelectItem>
            {activities.map((activity) => (
              <SelectItem key={activity.id} value={activity.id}>
                {activity.title} · {dateTimeFormatter.format(new Date(activity.scheduledAt))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-activity-location" className="text-[11px] text-muted">{t("locationLabel")}</Label> : null}
        <Input
          id={workflow ? "invitation-activity-location" : undefined}
          value={value.locationText}
          disabled={disabled}
          maxLength={200}
          className="h-8 text-xs"
          placeholder={t("locationPlaceholder")}
          aria-label={t("locationLabel")}
          onChange={(event) => update("locationText", event.target.value)}
        />
      </div>
      {selectedActivity ? (
        <p className="md:col-span-2 text-[11px] text-muted">
          {dateTimeFormatter.format(new Date(selectedActivity.scheduledAt))}
          {selectedActivity.location ? ` · ${selectedActivity.location}` : ""}
        </p>
      ) : null}
    </div>
  ) : value?.kind === "waiting_activity" ? (
    <p className="text-[11px] leading-4 text-muted">{t("waitingActivityHint")}</p>
  ) : null;

  const stateControls = value?.kind === "assessment_1v1" ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium text-muted">{t("stateLabel")}</p>
        <p className="flex items-center gap-1.5 text-[10px] text-muted">
          <Keyboard className="size-3 text-ink" aria-hidden="true" />
          <span>{t("stateManualHint")}</span>
        </p>
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${stateChoices.length}, minmax(0, 1fr))` }}
        role="group"
        aria-label={t("stateLabel")}
        aria-keyshortcuts="1 2 3 4"
      >
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
                "h-auto min-h-11 min-w-0 flex-col gap-1 rounded-lg px-1.5 py-1.5 text-center text-[11px] leading-4",
                passed && "bg-leaf/10 text-ink",
                selected && "bg-moon/35 text-ink",
              )}
              disabled={disabled || editingScope === "assessor"}
              aria-pressed={selected}
              aria-keyshortcuts={String(index + 1)}
              onClick={() => chooseState(state)}
            >
              <span className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                selected
                  ? "border-moon bg-moon text-ink"
                  : passed
                    ? "border-leaf-deep bg-leaf/50 text-ink"
                    : "border-line text-muted",
              )}>
                {passed ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="w-full truncate">{t(`state_${state}`)}</span>
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
      className={cn(workflow ? "grid gap-5 xl:grid-cols-[12rem_minmax(0,1fr)]" : "space-y-2")}
      data-testid="invitation-draft-fields"
      onKeyDownCapture={handleStateShortcut}
    >
      <section>
        {workflow ? (
          <p className="mb-2 text-[11px] font-medium text-muted">{t("kindLabel")}</p>
        ) : null}
        {kindChoices}
      </section>

      {value ? (
        <section className={cn("space-y-3", workflow && "border-line xl:border-l xl:pl-5")}>
          {stateControls}
          {workflow ? (
            <p className="text-[11px] font-medium text-muted">{t("arrangementFactsLabel")}</p>
          ) : null}
          {arrangementFields}

          {!workflow && !invitationDraftIsComplete(value) ? (
            <p className="text-[11px] leading-4 text-amber-700" role="status">{t("draftIncomplete")}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
