"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  onChange,
}: {
  value: InvitationDraft | null;
  activities: InvitationActivityOption[];
  assessors: InvitationAssessorOption[];
  locale: string;
  disabled?: boolean;
  allowNone?: boolean;
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

  return (
    <div className="space-y-2" data-testid="invitation-draft-fields">
      <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label={t("kindLabel")}>
        <span className="mr-1 text-[11px] text-muted">{t("kindLabel")}</span>
        {allowNone ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className={cn("h-7 px-2.5 text-[11px]", !value && "border-leaf-deep bg-leaf/60 text-ink")}
            disabled={disabled}
            aria-pressed={!value}
            onClick={() => chooseKind(null)}
          >
            {!value ? <Check className="size-3" /> : null}
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
              variant="secondary"
              className={cn("h-7 px-2.5 text-[11px]", selected && "border-leaf-deep bg-leaf/60 text-ink")}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => chooseKind(kind)}
            >
              {selected ? <Check className="size-3" /> : null}
              {t(`kind_${kind}`)}
            </Button>
          );
        })}
      </div>

      {value ? (
        <div className="space-y-2 rounded-xl border border-line/70 bg-background/45 p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label={t("stateLabel")}>
            <span className="mr-1 text-[11px] text-muted">{t("stateLabel")}</span>
            {stateChoices.map((state) => {
              const selected = value.state === state;
              return (
                <Button
                  key={state}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className={cn("h-7 px-2.5 text-[11px]", selected && "border-moon bg-moon/35 text-ink")}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => chooseState(state)}
                >
                  {selected ? <Check className="size-3" /> : null}
                  {t(`state_${state}`)}
                </Button>
              );
            })}
          </div>

          {value.kind === "assessment_1v1" ? (
            <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_minmax(12rem,1fr)]">
              <Input
                value={value.proposedTimeText}
                disabled={disabled}
                maxLength={200}
                className="h-8 text-xs"
                placeholder={t("timePlaceholder")}
                aria-label={t("timeLabel")}
                onChange={(event) => update("proposedTimeText", event.target.value)}
              />
              <Select
                value={value.assessorId ?? "none"}
                disabled={disabled}
                onValueChange={(assessorId) => update("assessorId", assessorId === "none" ? null : assessorId)}
              >
                <SelectTrigger className="h-8 text-xs" aria-label={t("assessorLabel")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("assessorPending")}</SelectItem>
                  {assessors.map((assessor) => (
                    <SelectItem key={assessor.userId} value={assessor.userId}>{assessor.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={value.locationText}
                disabled={disabled}
                maxLength={200}
                className="h-8 text-xs"
                placeholder={t("locationPlaceholder")}
                aria-label={t("locationLabel")}
                onChange={(event) => update("locationText", event.target.value)}
              />
            </div>
          ) : null}

          {value.kind === "activity" ? (
            <div className="grid gap-2 md:grid-cols-[minmax(18rem,1fr)_minmax(12rem,1fr)]">
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
                <SelectTrigger className="h-8 text-xs" aria-label={t("activityLabel")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>{activities.length > 0 ? t("activityPending") : t("activityEmpty")}</SelectItem>
                  {activities.map((activity) => (
                    <SelectItem key={activity.id} value={activity.id}>
                      {activity.title} · {dateTimeFormatter.format(new Date(activity.scheduledAt))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={value.locationText}
                disabled={disabled}
                maxLength={200}
                className="h-8 text-xs"
                placeholder={t("locationPlaceholder")}
                aria-label={t("locationLabel")}
                onChange={(event) => update("locationText", event.target.value)}
              />
              {selectedActivity ? (
                <p className="md:col-span-2 text-[11px] text-muted">
                  {dateTimeFormatter.format(new Date(selectedActivity.scheduledAt))}
                  {selectedActivity.location ? ` · ${selectedActivity.location}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {value.kind === "waiting_activity" ? (
            <p className="text-[11px] leading-4 text-muted">{t("waitingActivityHint")}</p>
          ) : null}

          {!invitationDraftIsComplete(value) ? (
            <p className="text-[11px] leading-4 text-amber-700" role="status">{t("draftIncomplete")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
