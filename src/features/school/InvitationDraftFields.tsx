"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  defaultInvitationState,
  invitationDraftIsComplete,
  invitationStatesForKind,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
  type InvitationKind,
  type InvitationState,
} from "./invitation-contract";

function blankDraft(kind: InvitationKind): InvitationDraft {
  return {
    kind,
    state: defaultInvitationState(kind),
    activityId: null,
    assessorId: null,
    proposedTimeText: "",
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
  onChange,
}: {
  value: InvitationDraft | null;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  disabled?: boolean;
  allowNone?: boolean;
  variant?: "inline" | "workflow";
  onChange: (value: InvitationDraft | null) => void;
}) {
  const t = useTranslations("school.invitations");
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }), [locale]);
  const chooseKind = (kind: InvitationKind | null) => {
    if (!kind) {
      onChange(null);
      return;
    }
    onChange(value?.kind === kind ? value : blankDraft(kind));
  };
  const update = <K extends keyof InvitationDraft>(key: K, next: InvitationDraft[K]) => {
    if (!value) return;
    onChange({ ...value, [key]: next });
  };
  const chooseState = (state: InvitationState) => {
    if (!value) return;
    onChange({ ...value, state });
  };
  const stateChoices = value ? invitationStatesForKind(value.kind) : [];
  const selectedActivity = value?.activityId
    ? activities.find((activity) => activity.id === value.activityId)
    : undefined;
  const selectedStateIndex = value ? stateChoices.indexOf(value.state) : -1;
  const workflow = variant === "workflow";

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
          disabled={disabled}
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
            disabled={disabled}
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
    <div className="grid gap-2 md:grid-cols-3">
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-time" className="text-[11px] text-muted">{t("timeLabel")}</Label> : null}
        <Input
          id={workflow ? "invitation-time" : undefined}
          value={value.proposedTimeText}
          disabled={disabled}
          maxLength={200}
          className="h-8 text-xs"
          placeholder={t("timePlaceholder")}
          aria-label={t("timeLabel")}
          onChange={(event) => update("proposedTimeText", event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        {workflow ? <Label htmlFor="invitation-assessor" className="text-[11px] text-muted">{t("assessorLabel")}</Label> : null}
        <Select
          value={value.assessorId ?? "none"}
          disabled={disabled}
          onValueChange={(assessorId) => update("assessorId", assessorId === "none" ? null : assessorId)}
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
          disabled={disabled}
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
            onChange({
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

  return (
    <div
      className={cn(workflow ? "grid gap-5 xl:grid-cols-[14rem_minmax(0,1fr)]" : "space-y-2")}
      data-testid="invitation-draft-fields"
    >
      <section>
        {workflow ? (
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-ink">
            <span className="flex size-5 items-center justify-center rounded-full bg-leaf/60 text-[11px]">1</span>
            {t("kindLabel")}
          </p>
        ) : null}
        {kindChoices}
      </section>

      {value ? (
        <section className={cn("space-y-3", workflow && "border-line xl:border-l xl:pl-5")}>
          {workflow ? (
            <p className="flex items-center gap-2 text-xs font-medium text-ink">
              <span className="flex size-5 items-center justify-center rounded-full bg-moon/60 text-[11px]">2</span>
              {t("stateLabel")}
            </p>
          ) : null}
          <div
            className={cn(
              workflow ? "grid gap-1.5" : "flex min-w-0 flex-wrap items-center gap-1",
            )}
            style={workflow ? { gridTemplateColumns: `repeat(${stateChoices.length}, minmax(0, 1fr))` } : undefined}
            role="group"
            aria-label={t("stateLabel")}
          >
            {!workflow ? <span className="mr-1 text-[11px] text-muted">{t("stateLabel")}</span> : null}
            {stateChoices.map((state, index) => {
              const selected = value.state === state;
              const passed = workflow && index < selectedStateIndex;
              return (
                <Button
                  key={state}
                  type="button"
                  size="sm"
                  variant={workflow ? "ghost" : "secondary"}
                  className={cn(
                    workflow
                      ? "h-auto min-h-11 min-w-0 flex-col gap-1 rounded-lg px-1.5 py-1.5 text-center text-[11px] leading-4"
                      : "h-7 px-2.5 text-[11px]",
                    selected && (workflow ? "bg-moon/35 text-ink" : "border-moon bg-moon/35 text-ink"),
                    passed && "bg-leaf/10 text-ink",
                  )}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => chooseState(state)}
                >
                  {workflow ? (
                    <span className={cn(
                      "flex size-5 items-center justify-center rounded-full border text-[10px]",
                      selected ? "border-moon bg-moon text-ink" : passed ? "border-leaf-deep bg-leaf/50 text-ink" : "border-line text-muted",
                    )}>
                      {passed ? <Check className="size-3" /> : index + 1}
                    </span>
                  ) : selected ? <Check className="size-3" /> : null}
                  <span className="truncate">{t(`state_${state}`)}</span>
                </Button>
              );
            })}
          </div>

          {workflow ? (
            <div className="border-l-2 border-moon px-3 py-1">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted">{t("currentTaskLabel")}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink">{t(`task_${value.state}`)}</p>
            </div>
          ) : null}

          {arrangementFields}

          {!invitationDraftIsComplete(value) ? (
            <p className="text-[11px] leading-4 text-amber-700" role="status">{t("draftIncomplete")}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
