"use client";

import { Check, ChevronRight, Keyboard } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { AssessmentAvailabilityGrid } from "./AssessmentAvailabilityGrid";
import { ActivityWeekPicker } from "./ActivityWeekPicker";
import { emptyInvitationDraft, invitationHasStageInformation, invitationTabSelection } from "./followup-entry-contract";
import {
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

export function InvitationDraftFields({
  value: committedValue,
  activities,
  assessors,
  locale,
  disabled = false,
  allowNone = true,
  showReminder = true,
  editingScope = "full",
  draftStorageKey,
  gradeHint,
  onChange,
}: {
  value: InvitationDraft | null;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  disabled?: boolean;
  allowNone?: boolean;
  showReminder?: boolean;
  editingScope?: "full" | "assessor";
  draftStorageKey?: string;
  gradeHint?: number | null;
  onChange: (value: InvitationDraft | null) => void;
}) {
  const t = useTranslations("school.invitations");
  const entryT = useTranslations("school.followupEntry");
  const reminderId = useId();
  // 页签浏览独立于已登记安排，空白页签不会覆盖其他页签中的阶段信息。
  const [browsingDraft, setBrowsingDraft] = useState<InvitationDraft | null>(null);
  const value = browsingDraft ?? committedValue ?? emptyInvitationDraft();
  const draftCacheRef = useRef<Partial<Record<InvitationKind, InvitationDraft>>>(
    committedValue ? { [committedValue.kind]: committedValue } : {},
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
    if (restored || allowNone) {
      onChangeRef.current(restored);
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
  const previousValueRef = useRef(committedValue);
  useEffect(() => {
    if (previousValueRef.current === committedValue) return;
    previousValueRef.current = committedValue;
    // 备注栏中的提醒同样属于当前邀约草稿，随受控值更新保持会话暂存。
    if (!committedValue || draftCacheRef.current[committedValue.kind]?.nextContactAt === committedValue.nextContactAt) return;
    draftCacheRef.current[committedValue.kind] = committedValue;
    persistDrafts(committedValue.kind);
  }, [persistDrafts, committedValue]);
  const emit = useCallback((next: InvitationDraft) => {
    setBrowsingDraft(null);
    draftCacheRef.current[next.kind] = next;
    persistDrafts(next.kind);
    onChangeRef.current(next);
  }, [persistDrafts]);
  const chooseKind = (kind: InvitationKind) => {
    draftCacheRef.current[value.kind] = value;
    const next = invitationTabSelection(committedValue, kind, draftCacheRef.current[kind]);
    if (next.register) emit(next.preview);
    else setBrowsingDraft(next.preview);
  };
  const update = <K extends keyof InvitationDraft>(key: K, next: InvitationDraft[K]) => {
    if (!value) return;
    emit({ ...value, [key]: next });
  };
  const stateChoices = value ? invitationStatesForKind(value.kind) : [];
  const selectedStateIndex = value ? stateChoices.indexOf(value.state) : -1;
  const chooseState = (state: InvitationState) => {
    if (!value) return;
    emit(selectInvitationProgress(value, state));
  };
  const handleStateShortcut = (event: InvitationShortcutEvent) => {
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
  };

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
    <ActivityWeekPicker activities={activities} gradeHint={gradeHint} selectedId={value.activityId} locale={locale}
      disabled={disabled || editingScope === "assessor"} onSelect={(activity) => emit({ ...value,
        activityId: activity.id, locationText: activity.location, state: "awaiting_parent", scheduledAt: null })} />
  ) : value?.kind === "waiting_activity" ? (
    <p className="text-[11px] leading-4 text-muted">{t("waitingActivityHint")}</p>
  ) : null;

  const stateControls = value && stateChoices.length > 1 && (value.kind !== "activity" || value.activityId) ? (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-medium text-ink">{t("stateLabel")}</p>
        {value.kind === "assessment_1v1" ? <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <Keyboard className="size-3 shrink-0 text-ink" aria-hidden="true" />
          <span>{t("stateManualHint")}</span>
        </p> : null}
      </div>
      <div className="flex min-w-0 flex-col @[30rem]/invitation-fields:flex-row @[30rem]/invitation-fields:items-start" role="group" aria-label={t("stateLabel")} aria-keyshortcuts={value.kind === "assessment_1v1" ? "1 2 3 4" : undefined}>
        {stateChoices.map((state, index) => {
          const selected = value.state === state;
          const passed = index < selectedStateIndex;
          return (
            <Fragment key={state}><Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-auto min-h-10 min-w-0 justify-start gap-2 whitespace-normal rounded-md px-1 py-1.5 text-left text-xs leading-5 @[30rem]/invitation-fields:flex-1 @[30rem]/invitation-fields:flex-col @[30rem]/invitation-fields:text-center",
                selected ? "font-medium text-ink" : "text-muted",
              )}
              disabled={disabled || editingScope === "assessor"}
              aria-pressed={selected}
              aria-current={selected ? "step" : undefined}
              aria-keyshortcuts={value.kind === "assessment_1v1" ? String(index + 1) : undefined}
              onClick={() => chooseState(state)}
            >
              <span aria-hidden="true" className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                selected ? "border-[var(--followup-outline)] bg-moon/25 text-ink ring-2 ring-[var(--followup-outline)]/25"
                  : passed ? "border-leaf-deep bg-leaf/25 text-ink"
                    : "border-muted/40 bg-card text-muted",
              )}>
                {passed ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="w-full">{t(`state_${state}`)}</span>
            </Button>{index < stateChoices.length - 1 ? <span aria-hidden="true" data-followup-progress-link={passed ? "complete" : "pending"}
              className={cn("relative ml-3 h-5 w-0 shrink-0 border-l-2 @[30rem]/invitation-fields:mx-1 @[30rem]/invitation-fields:mt-[18px] @[30rem]/invitation-fields:h-0 @[30rem]/invitation-fields:w-8 @[30rem]/invitation-fields:border-t-2 @[30rem]/invitation-fields:border-l-0",
                passed ? "border-solid border-leaf-deep text-leaf-deep" : "border-dashed border-muted/40 text-muted")}>
              <ChevronRight className="absolute -bottom-1 -left-[7px] size-3 rotate-90 @[30rem]/invitation-fields:-top-[7px] @[30rem]/invitation-fields:-right-1 @[30rem]/invitation-fields:bottom-auto @[30rem]/invitation-fields:left-auto @[30rem]/invitation-fields:rotate-0" />
            </span> : null}</Fragment>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-muted">
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
      <Tabs value={value.kind} onValueChange={(kind) => chooseKind(kind as InvitationKind)} className="min-w-0">
        <p className="mb-1.5 text-xs font-medium text-ink">{t("kindLabel")}</p>
        <TabsList aria-label={t("kindLabel")} className="h-10 w-full justify-start gap-1 rounded-md border border-line bg-card p-1">
          {(["activity", "assessment_1v1", "waiting_activity"] as const).map((kind) => <TabsTrigger key={kind} value={kind}
            disabled={disabled || editingScope === "assessor"} className="min-w-20 flex-1 text-xs data-[state=active]:bg-moon/25 data-[state=active]:shadow-none data-[state=active]:ring-1 data-[state=active]:ring-[var(--followup-outline)]/60">
            {entryT(`tab_${kind}`)}
          </TabsTrigger>)}
        </TabsList>
        <TabsContent value={value.kind} className="@container/invitation-fields min-w-0 space-y-3 pt-1">
          {browsingDraft && committedValue && invitationHasStageInformation(committedValue) && browsingDraft.kind !== committedValue.kind
            ? <p className="text-xs text-muted" role="status">{entryT("retainedArrangement", { kind: entryT(`tab_${committedValue.kind}`) })}</p> : null}
          {value.kind !== "activity" ? stateControls : null}
          {arrangementFields}
          {value.kind === "activity" ? stateControls : null}

          {showReminder && invitationCanHaveNextContactReminder(value) && editingScope !== "assessor" ? (
            <NextContactReminderField
              id={`invitation-next-contact-${reminderId}`}
              value={value.nextContactAt}
              disabled={disabled}
              className="w-full min-w-0 max-w-sm [&>button]:min-w-0 [&>button]:max-w-full"
              onChange={(nextContactAt) => update("nextContactAt", nextContactAt)}
            />
          ) : null}

          {invitationHasStageInformation(value) && !invitationDraftIsComplete(value) ? (
            <p className="text-[11px] leading-4 text-amber-700" role="status">{t("draftIncomplete")}</p>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
