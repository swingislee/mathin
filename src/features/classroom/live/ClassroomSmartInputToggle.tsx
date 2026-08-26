"use client";

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
        "h-11 w-28 shrink-0 justify-between gap-2 rounded-xl border border-line bg-card/70 px-3 text-ink shadow-none hover:border-crater/60 hover:bg-moon/25 disabled:opacity-55",
        active && "border-leaf-deep/35 bg-leaf/15 hover:bg-leaf/20",
        className,
      )}
      data-classroom-rail-group="input"
      data-classroom-smart-input={state}
      data-smart-preference={enabled ? "on" : "off"}
      title={hint}
      onClick={() => onChange(!enabled)}
    >
      <span className="whitespace-nowrap text-xs font-medium">{t("inputModeSmart")}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full bg-muted/30 p-0.5 transition-colors",
          active && "bg-leaf-deep",
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
