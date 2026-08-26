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
}: {
  enabled: boolean;
  available: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
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
    <Button
      type="button"
      size="sm"
      variant="ghost"
      role="switch"
      aria-checked={active}
      aria-label={label}
      disabled={!available}
      className={cn(
        "h-11 w-28 shrink-0 justify-between gap-2 rounded-none border-0 bg-transparent px-2 text-muted shadow-none hover:bg-transparent hover:text-ink disabled:opacity-55",
        className,
      )}
      data-classroom-rail-group="input"
      data-classroom-smart-input={state}
      data-smart-preference={enabled ? "on" : "off"}
      title={hint}
      onClick={() => onChange(!enabled)}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors",
          active && "text-rose",
        )}
      >
        <Sparkles aria-hidden size={15} />
        {t("inputModeSmart")}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full bg-muted/30 p-0.5 transition-colors",
          active && "bg-rose",
        )}
      >
        <span
          className={cn(
            "block size-4 rounded-full bg-card shadow-sm transition-transform",
            active && "translate-x-4",
          )}
        />
      </span>
    </Button>
  );
}
