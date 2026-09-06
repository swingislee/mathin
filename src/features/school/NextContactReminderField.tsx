"use client";

import { useTranslations } from "next-intl";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
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
      <Label htmlFor={id} className="text-xs text-muted">
        {t("nextContactReminderLabel")}
      </Label>
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
      {compact && valid ? <details className="text-[11px] leading-4 text-muted">
        <summary className="w-fit cursor-pointer">{t("nextContactReminderHelp")}</summary>
        <p id={hintId} className="pt-1">{t("nextContactReminderHint")}</p>
      </details> : <p id={hintId} className={cn("text-[11px] leading-4", valid ? "text-muted" : "text-rose")}>
        {valid ? t("nextContactReminderHint") : t("nextContactReminderPast")}
      </p>}
    </div>
  );
}
