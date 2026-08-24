"use client";

import { MousePointer2, PenLine, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ClassroomRoutingMode } from "../input/router";
import { cn } from "@/lib/utils";

const MODES = [
  { mode: "smart", icon: Sparkles, label: "inputModeSmart", hint: "inputModeSmartHint" },
  { mode: "interaction-lock", icon: MousePointer2, label: "inputModeInteraction", hint: "inputModeInteractionHint" },
  { mode: "ink-lock", icon: PenLine, label: "inputModeInk", hint: "inputModeInkHint" },
] as const;

export function ClassroomInputModeControl({
  value,
  protectedRenderer,
  onChange,
  className,
  compact = false,
}: {
  value: ClassroomRoutingMode;
  protectedRenderer: boolean;
  onChange: (mode: ClassroomRoutingMode) => void;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("classroom.live");
  return (
    <div
      aria-label={t("inputModeGroup")}
      className={cn("flex flex-wrap items-center gap-1 rounded-xl border border-line bg-paper/95 p-1 shadow-sm backdrop-blur", className)}
      data-classroom-input-mode={value}
      role="group"
    >
      {MODES.map(({ mode, icon: Icon, label, hint }) => (
        <Button
          key={mode}
          type="button"
          size="sm"
          variant={value === mode ? "primary" : "ghost"}
          aria-pressed={value === mode}
          className="min-h-11 gap-1.5 px-2.5"
          data-input-mode-option={mode}
          title={t(hint)}
          onClick={() => onChange(mode)}
        >
          <Icon aria-hidden size={15} />
          <span className={compact ? "sr-only" : undefined}>{t(label)}</span>
        </Button>
      ))}
      {protectedRenderer && !compact ? (
        <span className="max-w-52 px-2 text-[11px] leading-tight text-crater" role="status">
          {t("inputRendererProtected")}
        </span>
      ) : null}
    </div>
  );
}
