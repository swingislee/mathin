"use client";

import { useState } from "react";
import { MoveVertical, ZoomIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

/** 大小与位置共用右侧竖向操作区，各自收起后保留原位的展开按钮。 */
export function ClassroomViewportControls({ focused, height, value, min, max, verticalPosition, onResize, onPan, onCommit }: {
  focused: boolean;
  height: number;
  value: number;
  min: number;
  max: number;
  verticalPosition: number | null;
  onResize: (percent: number) => void;
  onPan: (position: number) => void;
  onCommit: () => void;
}) {
  const t = useTranslations("classroom.live");
  const [sizeOpen, setSizeOpen] = useState(true);
  const [positionOpen, setPositionOpen] = useState(true);
  const railHeight = Math.max(44, Math.min(168, height * 0.25, height - 176));
  const controls = [
    { key: "size", visible: true, open: sizeOpen, toggle: () => setSizeOpen((open) => !open), icon: ZoomIn,
      shortLabel: t("coursewareSizeShort"), label: t("coursewareDisplaySize"), toggleLabel: t(sizeOpen ? "hideCoursewareSizeSlider" : "showCoursewareSizeSlider"),
      value, min, max, disabled: min === max, valueText: t("displayWidthPercent", { value: Math.round(value) }), onChange: onResize },
    { key: "position", visible: focused, open: positionOpen, toggle: () => setPositionOpen((open) => !open), icon: MoveVertical,
      shortLabel: t("verticalPositionShort"), label: t("displayVerticalPosition"), toggleLabel: t(positionOpen ? "hideVerticalPositionSlider" : "showVerticalPositionSlider"),
      value: 100 - (verticalPosition ?? 50), min: 0, max: 100, disabled: verticalPosition === null,
      valueText: t("displayPositionPercent", { value: Math.round(verticalPosition ?? 50) }), onChange: (next: number) => onPan(100 - next) },
  ];
  return (
    <div className="pointer-events-none absolute right-1 top-0 z-50 flex items-start gap-0.5"
      style={{ top: Math.max(4, (height - 80 - railHeight - 86) / 2) }} data-classroom-viewport-controls>
      {controls.filter((control) => control.visible).map((control) => (
        <div key={control.key} className="pointer-events-auto flex w-11 flex-col items-center gap-1" data-classroom-viewport-control={control.key}>
          <Button type="button" variant="ghost" className="size-11 flex-col gap-0.5 rounded-full bg-paper/85 p-0 text-muted shadow-sm backdrop-blur-sm hover:bg-paper hover:text-ink"
            aria-label={control.toggleLabel} title={control.toggleLabel} aria-expanded={control.open} onClick={control.toggle}>
            <control.icon aria-hidden size={15} />
            <span className="text-[10px] leading-none">{control.shortLabel}</span>
          </Button>
          {control.open && (
            <div className="flex w-9 flex-col items-center gap-2 rounded-full bg-paper/80 py-3 backdrop-blur-sm">
              <Slider orientation="vertical" aria-label={control.label} aria-valuetext={control.valueText}
                value={[control.value]} min={control.min} max={control.max} step={1} disabled={control.disabled}
                onValueChange={([next]) => control.onChange(next)} onValueCommit={onCommit}
                style={{ height: railHeight }} className="w-11 data-[disabled]:opacity-35"
                thumbClassName="relative size-4 cursor-ns-resize rounded-sm after:absolute after:-inset-3.5 after:content-['']" />
              <output className="text-[10px] leading-none tabular-nums text-muted" aria-hidden>{control.disabled ? "—" : `${Math.round(control.key === "size" ? value : verticalPosition ?? 50)}%`}</output>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
