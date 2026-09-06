"use client";

import { useTranslations } from "next-intl";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dateTimeInputToInstant, zonedDateTimeInputValue } from "./schedule";

export const NEXT_CONTACT_REMINDER_TIME_ZONE = "Asia/Shanghai";

export function isFutureNextContactReminder(
  value: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!value) return true;
  const instant = new Date(value).getTime();
  return Number.isFinite(instant) && instant > now;
}

export function NextContactReminderField({
  id,
  value,
  disabled = false,
  className,
  compact = false,
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("school.invitations");
  const valid = isFutureNextContactReminder(value);
  const hintId = `${id}-hint`;
  const localValue = value && !Number.isNaN(new Date(value).getTime())
    ? zonedDateTimeInputValue(new Date(value), NEXT_CONTACT_REMINDER_TIME_ZONE)
    : "";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-1">
        <Label htmlFor={id} className="text-xs text-muted">{t("nextContactReminderLabel")}</Label>
        {compact ? <TooltipProvider delayDuration={200}><Tooltip>
          <TooltipTrigger asChild><Button type="button" size="sm" variant="ghost" className="size-6 p-0 text-muted" aria-label={t("nextContactReminderHelp")}>
            <CircleHelp className="size-3.5" aria-hidden />
          </Button></TooltipTrigger>
          <TooltipContent className="max-w-72 leading-5">{t("nextContactReminderHint")}</TooltipContent>
        </Tooltip></TooltipProvider> : null}
      </div>
      <DateTimePicker
        id={id}
        mode="datetime"
        value={localValue}
        disabled={disabled}
        placeholder={t("nextContactReminderPlaceholder")}
        className="h-auto min-h-9 whitespace-normal text-xs [&>span]:whitespace-normal [&>span]:text-clip [&>span]:break-words"
        aria-describedby={hintId}
        aria-invalid={!valid}
        onValueChange={(next) => {
          if (!next) {
            onChange(null);
            return;
          }
          const instant = dateTimeInputToInstant(next, NEXT_CONTACT_REMINDER_TIME_ZONE);
          onChange(instant?.toISOString() ?? null);
        }}
      />
      <p id={hintId} className={cn("text-[11px] leading-4", valid ? "text-muted" : "text-rose", compact && valid && "sr-only")}>
        {valid ? t("nextContactReminderHint") : t("nextContactReminderPast")}
      </p>
    </div>
  );
}
