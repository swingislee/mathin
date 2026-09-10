"use client";

import { Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";

export function ClassroomDisplayControls({
  focused, onFocus, adjustable, value, min, max, onResize, onReset, onCommit, following, onFollow, saveError,
}: {
  focused: boolean;
  onFocus: (focused: boolean) => void;
  adjustable: boolean;
  value: number;
  min: number;
  max: number;
  onResize: (percent: number) => void;
  onReset: () => void;
  onCommit: () => void;
  following?: boolean;
  onFollow?: () => void;
  saveError?: boolean;
}) {
  const t = useTranslations("classroom.live");
  const focusLabel = t(focused ? "exitFocus" : "enterFocus");
  const railClass = "size-11 shrink-0 rounded-full p-0 text-muted hover:bg-moon/30 hover:text-ink";
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-classroom-display-controls>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" className={railClass} aria-label={t("displaySettings")} title={t("displaySettings")}
            data-classroom-rail-button="display-settings">
            <SlidersHorizontal aria-hidden size={18} />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-72 space-y-4 p-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{t("coursewareDisplaySize")}</span>
            <output className="font-mono text-xs text-muted">{adjustable ? t("displayWidthPercent", { value: Math.round(value) }) : "4:3"}</output>
          </div>
          <Slider aria-label={t("coursewareDisplaySize")} aria-valuetext={t("displayWidthPercent", { value: Math.round(value) })}
            value={[value]} min={min} max={max} step={1} disabled={!adjustable || min === max}
            onValueChange={([percent]) => onResize(percent)} onValueCommit={onCommit} className="min-h-8" />
          <p className="text-xs leading-relaxed text-muted">{t(!adjustable ? "displaySizeNarrowHint" : focused ? "displaySizeFocusHint" : "displaySizeHint")}</p>
          {onFollow && <Button type="button" variant="secondary" size="sm" className="w-full" disabled={following} onClick={onFollow}>{t(following ? "followingTeacherViewport" : "followTeacherViewport")}</Button>}
          {saveError && <p role="status" className="text-xs text-crater">{t("displaySyncSaveError")}</p>}
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={onReset}>{t("resetDisplaySize")}</Button>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" className={railClass} aria-label={focusLabel} title={focusLabel}
        aria-pressed={focused} onClick={() => onFocus(!focused)} data-classroom-rail-button="focus">
        {focused ? <Minimize2 aria-hidden size={18} /> : <Maximize2 aria-hidden size={18} />}
      </Button>
    </div>
  );
}
