"use client";

import { Check, ChevronRight, Signpost } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FollowupChoice } from "./dashboard-page/FollowupChoice";
import { AssessmentAvailabilityGrid } from "./AssessmentAvailabilityGrid";
import { ActivityWeekPicker } from "./ActivityWeekPicker";
import { emptyInvitationDraft, invitationDraftIssue, invitationHasStageInformation, invitationTabSelection } from "./followup-entry-contract";
import {
  INVITATION_KINDS,
  INVITATION_STATES,
  invitationCanHaveNextContactReminder,
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
import microStyles from "./followup-micro-interactions.module.css";
import { FollowupFieldIcon } from "./FollowupFieldIcon";
import { followupKeyContext } from "./followup-keyboard";

interface StoredInvitationDrafts {
  version: 1;
  selectedKind: InvitationKind | null;
  drafts: Partial<Record<InvitationKind, InvitationDraft>>;
}

const ASSESSMENT_PROGRESS_STATES = invitationStatesForKind("assessment_1v1");
const HANDOFF_KINDS = ["activity", "assessment_1v1", "waiting_activity"] as const;

type InvitationShortcutEvent = KeyboardEvent<HTMLDivElement>;

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
  contactFacts,
  enableProgressShortcuts = true,
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
  contactFacts?: ReactNode;
  enableProgressShortcuts?: boolean;
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
      !enableProgressShortcuts
      || followupKeyContext(event).overlay
      || event.defaultPrevented
      || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229
      || !value
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
    <div data-assessment-fields className="grid min-w-0 max-w-[58rem] items-start gap-3 @[40rem]/invitation-fields:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs text-muted">{t("assessorLabel")}</p>
        <FollowupChoice presentation="select" className="w-full min-w-0 max-w-full" label={t("assessorLabel")} value={value.assessorId ?? "none"}
          disabled={disabled || editingScope === "assessor"} options={[{ value: "none", label: t("assessorPending") }, ...assessors.map((assessor) => ({ value: assessor.userId, label: assessor.displayName }))]}
          onValueChange={(assessorId) => {
            const nextAssessorId = assessorId === "none" ? null : assessorId;
            emit({ ...value, assessorId: nextAssessorId,
              assessorTimeOptions: nextAssessorId === value.assessorId ? value.assessorTimeOptions : [],
              scheduledAt: nextAssessorId === value.assessorId ? value.scheduledAt : null });
          }} />
      </div>
      <div className="min-w-0 space-y-1.5 [&>button]:min-w-0 [&>button]:max-w-full">
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
      onChooseAssessment={() => chooseKind("assessment_1v1")}
      disabled={disabled || editingScope === "assessor"} onSelect={(activity) => emit({ ...value,
        activityId: activity.id, locationText: activity.location, state: "awaiting_parent", scheduledAt: null })} />
  ) : null;

  const stateControls = value && stateChoices.length > 1 && (value.kind !== "activity" || value.activityId) ? (
    <div className="flex min-w-0 max-w-[58rem] flex-wrap items-center gap-x-4 gap-y-1">
      <p className="text-xs text-muted">{t("stateLabel")}</p>
      <div data-invitation-progress className="flex min-w-0 flex-col items-start @[38rem]/invitation-fields:flex-row @[38rem]/invitation-fields:items-center" role="group" aria-label={t("stateLabel")} aria-keyshortcuts={enableProgressShortcuts && value.kind === "assessment_1v1" ? "1 2 3 4" : undefined}>
        {stateChoices.map((state, index) => {
          const selected = value.state === state;
          const passed = index < selectedStateIndex;
          return (
            <Fragment key={state}><Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-10 min-w-0 justify-start gap-1.5 whitespace-normal rounded-md px-0 py-1 text-left text-xs font-medium leading-4",
                selected ? "text-ink" : "text-muted",
              )}
              disabled={disabled || editingScope === "assessor"}
              aria-pressed={selected}
              aria-current={selected ? "step" : undefined}
              aria-keyshortcuts={enableProgressShortcuts && value.kind === "assessment_1v1" ? String(index + 1) : undefined}
              onClick={() => chooseState(state)}
            >
              <span aria-hidden="true" className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
                selected ? "border-[var(--followup-outline)] bg-moon/25 text-ink ring-2 ring-[var(--followup-outline)]/25"
                  : passed ? "border-leaf-deep bg-leaf/25 text-ink"
                    : "border-muted/40 bg-card text-muted",
              )}>
                {passed ? <Check className="size-3" /> : index + 1}
              </span>
              <span className="max-w-32">{t(`state_${state}`)}</span>
            </Button>{index < stateChoices.length - 1 ? <span aria-hidden="true" data-followup-progress-link={passed ? "complete" : "pending"}
              className={cn("relative ml-2.5 h-3 w-0 shrink-0 border-l-2 @[38rem]/invitation-fields:mx-2 @[38rem]/invitation-fields:h-0 @[38rem]/invitation-fields:w-5 @[38rem]/invitation-fields:border-t-2 @[38rem]/invitation-fields:border-l-0",
                passed ? "border-solid border-leaf-deep text-leaf-deep" : "border-dashed border-muted/40 text-muted")}>
              <ChevronRight className="absolute -bottom-1 -left-[7px] size-3 rotate-90 @[38rem]/invitation-fields:-top-[7px] @[38rem]/invitation-fields:-right-1 @[38rem]/invitation-fields:bottom-auto @[38rem]/invitation-fields:left-auto @[38rem]/invitation-fields:rotate-0" />
            </span> : null}</Fragment>
          );
        })}
      </div>
    </div>
  ) : null;
  const issue = invitationHasStageInformation(value) ? invitationDraftIssue(value) : null;

  return (
    <div
      className="@container/invitation-draft min-w-0 max-w-full"
      data-testid="invitation-draft-fields"
      onKeyDownCapture={handleStateShortcut}
    >
      <Tabs value={value.kind} onValueChange={(kind) => chooseKind(kind as InvitationKind)} className="min-w-0">
        <div data-followup-facts-toolbar className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          {contactFacts}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
            <FollowupFieldIcon icon={Signpost} label={t("kindLabel")} />
            <TabsList aria-label={t("kindLabel")} data-followup-handoff
              className="grid h-8 w-max max-w-full grid-cols-3 gap-0.5 bg-transparent p-0">
              {HANDOFF_KINDS.map((kind) => <TabsTrigger key={kind} value={kind}
                disabled={disabled || editingScope === "assessor"} className={cn(microStyles.handoffChoice, "relative h-8 min-w-11 cursor-pointer rounded-full border-0 bg-transparent px-2 py-0 text-xs text-ink leading-none transition-colors data-[state=active]:bg-transparent data-[state=active]:shadow-none")}>
                <svg aria-hidden="true" focusable="false" viewBox="0 0 100 32" preserveAspectRatio="none" className={microStyles.handoffMark} data-followup-handoff-mark={kind}>
                  <path className={microStyles.handoffWash} d="M11 7C29 2 77 3 90 9C99 16 90 25 73 27C50 30 21 28 10 23C2 18 3 11 11 7Z" />
                  <path className={microStyles.handoffLine} pathLength="1" d="M82 5C64 2 29 2 12 8C0 12 1 21 15 26C34 31 75 30 90 23C100 18 96 9 86 6" />
                </svg>
                <span className="relative">{entryT(`tab_${kind}`)}</span>
              </TabsTrigger>)}
            </TabsList>
          </div>
        </div>
        <TabsContent value={value.kind} className="@container/invitation-fields min-w-0 space-y-3 pt-1">
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

          <div data-invitation-validation className="min-h-5 max-w-[58rem] text-xs leading-5 text-rose">
            {issue ? <p role="alert">{t(issue)}</p> : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
