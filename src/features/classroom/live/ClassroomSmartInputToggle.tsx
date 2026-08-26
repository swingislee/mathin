"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ClassroomSmartInputToggle({
  enabled,
  available,
  onChange,
  className,
  compact = false,
  rail = false,
}: {
  enabled: boolean;
  available: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
  compact?: boolean;
  rail?: boolean;
}) {
  const t = useTranslations("classroom.live");
  const active = available && enabled;
  const state = available ? (active ? "on" : "off") : "unavailable";
  const label = !available
    ? t("inputSmartUnavailable")
    : active
      ? t("inputSmartDisable")
      : t("inputSmartEnable");
  const hint = !available
    ? t("inputSmartUnavailableHint")
    : active
      ? t("inputSmartOnHint")
      : t("inputSmartOffHint");

  return (
    <div
      aria-label={t("inputModeGroup")}
      className={cn(
        rail
          ? "flex shrink-0 items-center rounded-xl bg-card/70 p-0.5"
          : "flex items-center rounded-xl border border-line bg-paper/95 p-1 shadow-sm backdrop-blur",
        className,
      )}
      data-classroom-rail-group={rail ? "input" : undefined}
    >
      <Button
        type="button"
        size="sm"
        variant={rail ? "ghost" : active ? "primary" : "ghost"}
        role="switch"
        aria-checked={active}
        aria-label={label}
        disabled={!available}
        className={cn(
          rail
            ? "size-11 gap-0 rounded-full p-0 hover:bg-moon/30"
            : "min-h-11 gap-1.5 px-2.5",
          rail && active && "bg-moon/60 text-ink hover:bg-moon/60",
        )}
        data-classroom-smart-input={state}
        data-smart-preference={enabled ? "on" : "off"}
        title={hint}
        onClick={() => onChange(!enabled)}
      >
        <Sparkles aria-hidden size={15} />
        <span className={compact ? "sr-only" : undefined}>{t("inputModeSmart")}</span>
      </Button>
    </div>
  );
}
