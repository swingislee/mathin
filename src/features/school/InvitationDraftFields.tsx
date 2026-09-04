"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AssessmentAvailabilityGrid } from "./AssessmentAvailabilityGrid";
import {
  defaultInvitationState,
  invitationDraftIsComplete,
  invitationStateFromFacts,
  type InvitationActivityOption,
  type InvitationAssessorOption,
  type InvitationDraft,
  type InvitationKind,
} from "./invitation-contract";

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
  onChange: (value: InvitationDraft | null) => void;
}) {
  const t = useTranslations("school.invitations");
  const workflow = variant === "workflow";
  const emit = (next: InvitationDraft) => onChange(workflow ? next : {
    ...next,
    state: invitationStateFromFacts(next),
  });
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
    const next = value?.kind === kind ? value : blankDraft(kind);
    emit(next);
  };
  const update = <K extends keyof InvitationDraft>(key: K, next: InvitationDraft[K]) => {
    if (!value) return;
    emit({ ...value, [key]: next });
  };
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

  return (
    <div
      className={cn(workflow ? "grid gap-5 xl:grid-cols-[12rem_minmax(0,1fr)]" : "space-y-2")}
      data-testid="invitation-draft-fields"
    >
      <section>
        {workflow ? (
          <p className="mb-2 text-[11px] font-medium text-muted">{t("kindLabel")}</p>
        ) : null}
        {kindChoices}
      </section>

      {value ? (
        <section className={cn("space-y-3", workflow && "border-line xl:border-l xl:pl-5")}>
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
