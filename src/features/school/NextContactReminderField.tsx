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
  onChange,
}: {
  id: string;
  value: string | null | undefined;
  disabled?: boolean;
  className?: string;
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
      <Label htmlFor={id} className="text-[11px] text-muted">
        {t("nextContactReminderLabel")}
      </Label>
      <DateTimePicker
        id={id}
        mode="datetime"
        value={localValue}
        disabled={disabled}
        placeholder={t("nextContactReminderPlaceholder")}
        className="h-8 text-xs"
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
      <p id={hintId} className={cn("text-[10px] leading-4", valid ? "text-muted" : "text-rose")}>
        {valid ? t("nextContactReminderHint") : t("nextContactReminderPast")}
      </p>
    </div>
  );
}
