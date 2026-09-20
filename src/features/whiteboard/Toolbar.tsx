"use client";

import { useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Diamond,
  Download,
  DraftingCompass,
  Eraser,
  Hexagon,
  Minus,
  MousePointer2,
  PaintBucket,
  Palette,
  Ruler,
  Scissors,
  Shapes,
  Square,
  Star,
  Trash2,
  Triangle,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore } from "zustand";
import { cn } from "@/lib/utils";
import { colorVar, exportPng, resolveColor } from "./strokes";
import { CustomColorPicker } from "./CustomColorPicker";
import { isHexColor } from "./board-color";
import { SIZE_PRESETS, useWhiteboardStore, type WhiteboardStore } from "./store";
import { COLOR_TOKENS, isShapeItem, type BoardColor, type ColorToken, type InstrumentKind, type ShapeKind, type Tool } from "./types";

const ERASER_TOOLS: Tool[] = ["strokeEraser", "eraserS", "eraserM", "eraserL"];
const SIZE_ORDER = ["extraThin", "thin", "medium", "thick"] as const;
const QUICK_COLOR_TOKENS = ["ink", "rose", "blue"] as const satisfies readonly ColorToken[];
const MORE_COLOR_TOKENS = COLOR_TOKENS.filter((token) => !QUICK_COLOR_TOKENS.includes(token as (typeof QUICK_COLOR_TOKENS)[number]));
type SizeLabelKey = "sizeExtraThin" | "sizeThin" | "sizeMedium" | "sizeThick";
type QuickColorLabelKey = "quickColorPrimary" | "quickColorRed" | "quickColorBlue";
const INSERT_SHAPES: ShapeKind[] = ["line", "arrow", "rectangle", "ellipse", "triangle", "rightTriangle", "diamond", "pentagon", "hexagon", "star"];

const SHAPE_ICONS: Partial<Record<ShapeKind, ComponentType<{ size?: number }>>> = {
  line: Minus,
  arrow: ArrowRight,
  rectangle: Square,
  ellipse: Circle,
  triangle: Triangle,
  diamond: Diamond,
  hexagon: Hexagon,
  star: Star,
};

function RightTriangleIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4v15h14L5 4Z" /></svg>;
}

function PentagonIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 9 7-3.5 10h-11L3 10l9-7Z" /></svg>;
}

function ProtractorIcon({ size = 18 }: { size?: number }) {
  return <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 19a9 9 0 0 1 18 0H3Z" /><path d="M12 19v-4m-6.5 4 1.3-3.6M18.5 19l-1.3-3.6" /></svg>;
}

function ShapeIcon({ shape, size = 18 }: { shape: ShapeKind; size?: number }) {
  if (shape === "rightTriangle") return <RightTriangleIcon size={size} />;
  if (shape === "pentagon") return <PentagonIcon size={size} />;
  const Icon = SHAPE_ICONS[shape] ?? Shapes;
  return <Icon size={size} />;
}

/** 课堂多板场景：清空前勾选目标板（默认勾选主板书）；独立白板不传。 */
export interface ClearTarget {
  key: string;
  label: string;
  store: WhiteboardStore;
  defaultChecked?: boolean;
}

function ClearTargetRow({ target, checked, onToggle }: { target: ClearTarget; checked: boolean; onToggle: () => void }) {
  const hasItems = useStore(target.store, (state) => state.items.length > 0);
  return (
    <label className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-moon/20">
      <Checkbox checked={checked} onCheckedChange={onToggle} />
      <span className={cn("flex-1", !hasItems && "text-muted")}>{target.label}</span>
    </label>
  );
}

function ToolButton({ active, label, onClick, disabled, large = false, children }: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-colors",
        large ? "size-11" : "size-9",
        active ? "bg-moon/60 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function Toolbar({
  title,
  store = useWhiteboardStore,
  clearTargets,
  className,
  largeTargets = false,
  variant = "floating",
  railExpanded = false,
  swatchStyle,
}: {
  title: string;
  store?: WhiteboardStore;
  clearTargets?: ClearTarget[];
  className?: string;
  largeTargets?: boolean;
  variant?: "floating" | "rail";
  railExpanded?: boolean;
  /** Optional semantic color scope for previews when app chrome and canvas use different themes. */
  swatchStyle?: CSSProperties;
}) {
  const t = useTranslations("whiteboard.board.tools");
  const colorNames = useTranslations("whiteboard.board.colors");
  const tool = useStore(store, (state) => state.tool);
  const color = useStore(store, (state) => state.color);
  const fill = useStore(store, (state) => state.fill);
  const sizeNorm = useStore(store, (state) => state.sizeNorm);
  const selectedIds = useStore(store, (state) => state.selectedIds);
  const selectedHasShape = useStore(store, (state) => state.items.some((item) => selectedIds.includes(item.id) && isShapeItem(item)));
  const canUndo = useStore(store, (state) => state.undoStack.length > 0);
  const hasItems = useStore(store, (state) => state.items.length > 0);
  const setTool = useStore(store, (state) => state.setTool);
  const setColor = useStore(store, (state) => state.setColor);
  const setFill = useStore(store, (state) => state.setFill);
  const setSizeNorm = useStore(store, (state) => state.setSizeNorm);
  const setShapeKind = useStore(store, (state) => state.setShapeKind);
  const undo = useStore(store, (state) => state.undo);
  const clear = useStore(store, (state) => state.clear);
  const addInstrument = useStore(store, (state) => state.addInstrument);
  const lastEraser = useStore(store, (state) => state.lastEraser);
  const [collapsed, setCollapsed] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const paletteRef = useRef<HTMLSpanElement>(null);
  const [clearSelected, setClearSelected] = useState<Set<string>>(
    () => new Set(clearTargets?.filter((target) => target.defaultChecked).map((target) => target.key) ?? []),
  );
  const isRail = variant === "rail";
  const isEraser = ERASER_TOOLS.includes(tool);
  const sizePreset = SIZE_ORDER.find((key) => SIZE_PRESETS[key] === sizeNorm);
  // 界面按统一线宽标尺显示；写入时仍使用画布参照宽度的归一化值。
  const sizeValue = Math.round(sizeNorm * 10_000) / 10;
  const sizeLabel = sizePreset ? t(`size${sizePreset.charAt(0).toUpperCase()}${sizePreset.slice(1)}` as SizeLabelKey) : t("sizeCustom");

  const pickEraser = (next: Tool) => {
    setTool(next);
  };
  const pickColor = (next: BoardColor) => {
    setColor(next);
    if (selectedIds.length) store.getState().styleSelected({ color: next });
    setTool("pen");
  };
  const pickFill = (next: BoardColor | null) => {
    setFill(next);
    if (selectedHasShape) store.getState().styleSelected({ fill: next });
  };
  const insertInstrument = (kind: InstrumentKind) => {
    addInstrument(kind);
    setTool("pointer");
  };

  if (!isRail && collapsed) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-whiteboard-toolbar-toggle
        aria-expanded="false"
        aria-label={t("showToolbar")}
        title={t("showToolbar")}
        onClick={() => setCollapsed(false)}
        className={cn(largeTargets ? "h-11" : "h-9", "rounded-full bg-paper/95 px-3 text-xs shadow-sm backdrop-blur hover:-translate-y-0.5", className)}
      >
        <ChevronUp size={15} />
        {t("showToolbar")}
      </Button>
    );
  }

  return (
    // 上限按所在列算而不是按视口算（doc 27 §5.1）：工具栏浮在主板书列内居中，
    // 而 100vw 是整个视口——主板书只有 700px 时，工具栏会长到盖住右侧副板书。
    <div
      className={cn(
        "flex items-center gap-0.5 transition-[transform,opacity] duration-200 select-none",
        isRail
          ? cn("max-w-none overflow-visible", railExpanded && "h-auto w-full flex-wrap content-center justify-center")
          : "max-w-full overflow-x-auto rounded-2xl border border-line bg-paper/90 p-1.5 shadow-lg backdrop-blur",
        className,
      )}
      data-whiteboard-toolbar={isRail ? "rail" : "floating"}
      data-whiteboard-toolbar-layout={isRail && railExpanded ? "wrapped" : "row"}
    >
      <span ref={paletteRef} aria-hidden className="hidden" style={swatchStyle} data-whiteboard-swatch-palette />
      <ToolButton large={largeTargets} active={tool === "pointer"} label={t("pointer")} onClick={() => setTool("pointer")}>
        <MousePointer2 size={18} />
      </ToolButton>

      <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <div
        role="group"
        data-tool-group="drawing"
        aria-label={`${t("pen")} · ${t("eraser")} · ${t("color")} · ${t("size")}`}
        className={cn("flex shrink-0 items-center gap-0.5", !isRail && "rounded-xl bg-card/70 p-0.5")}
      >
      <Popover>
        <div className="flex items-center">
          <ToolButton large={largeTargets} active={isEraser} label={t("eraser")} onClick={() => setTool(lastEraser)}><Eraser size={18} /></ToolButton>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t("eraserOptions")} className="-ml-1.5 rounded-full p-0.5 text-muted transition-colors hover:text-ink"><ChevronUp size={13} /></button>
          </PopoverTrigger>
        </div>
        <PopoverContent side="top" className="w-auto p-1.5">
          <div className="flex flex-col gap-0.5">
            {ERASER_TOOLS.map((eraser) => (
              <button key={eraser} type="button" onClick={() => pickEraser(eraser)} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors", tool === eraser ? "bg-moon/60 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink")}>
                {eraser === "strokeEraser" ? <Scissors size={15} /> : <Eraser size={15} />}{t(eraser)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <div role="group" data-quick-colors aria-label={t("color")} className="flex shrink-0 items-center gap-0.5">
        {QUICK_COLOR_TOKENS.map((token) => {
          const labelKey: QuickColorLabelKey = token === "ink"
            ? "quickColorPrimary"
            : token === "rose"
              ? "quickColorRed"
              : "quickColorBlue";
          const active = tool === "pen" && color === token;
          return (
            <button
              key={token}
              type="button"
              data-quick-color={token}
              aria-label={t(labelKey)}
              title={t(labelKey)}
              aria-pressed={active}
              onClick={() => pickColor(token)}
              className={cn(
                "relative grid shrink-0 place-items-center rounded-full transition-colors hover:bg-moon/30",
                largeTargets ? "size-11" : "size-9",
                active && "bg-moon/30",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-5 place-items-center rounded-full border border-line shadow-sm transition-transform",
                  active && "scale-110 ring-2 ring-ink/60 ring-offset-1 ring-offset-paper",
                )}
                style={{ ...swatchStyle, background: colorVar(token) }}
              >
                {active ? <Check size={12} strokeWidth={3} className="text-paper" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <Popover open={colorsOpen} onOpenChange={setColorsOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={isHexColor(color) ? t("currentCustomColor", { color }) : t("moreColors")} title={t("moreColors")} className={cn("relative grid shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink", largeTargets ? "size-11" : "size-9", tool === "pen" && isHexColor(color) && "bg-moon/30 ring-2 ring-inset ring-crater")}>
            <Palette size={18} />
            {isHexColor(color) ? <span aria-hidden className="absolute bottom-1 right-1 size-3 rounded-full border border-line" style={{ backgroundColor: color }} /> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64 p-3">
          <div className="grid grid-cols-4 gap-2">
            {MORE_COLOR_TOKENS.map((token) => (
              <button key={token} type="button" aria-label={colorNames(token)} title={colorNames(token)} aria-pressed={color === token} onClick={() => pickColor(token)} className={cn("grid size-11 place-items-center rounded-full transition-colors hover:bg-moon/30", color === token && "ring-2 ring-crater")}>
                <span aria-hidden className="size-7 rounded-full border border-line" style={{ ...swatchStyle, background: colorVar(token) }} />
              </button>
            ))}
          </div>
          <CustomColorPicker key={color} resolveInitialColor={() => resolveColor(paletteRef.current ?? document.documentElement, color)}
            onApply={(next) => { pickColor(next); setColorsOpen(false); }} />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("size")} title={t("size")} className={cn("grid shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-moon/30", largeTargets ? "size-11" : "size-9")}><span aria-hidden className="rounded-full bg-current" style={{ width: Math.max(2, sizeValue), height: Math.max(2, sizeValue) }} /></button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>{t("size")}</span>
            <span className="tabular-nums text-ink">{sizeLabel} · {sizeValue.toFixed(1)}</span>
          </div>
          <div className="flex items-center gap-1">
            {SIZE_ORDER.map((key, index) => {
              const labelKey = `size${key.charAt(0).toUpperCase()}${key.slice(1)}` as SizeLabelKey;
              return (
                <Button key={key} type="button" variant="ghost" aria-label={t(labelKey)} aria-pressed={sizeNorm === SIZE_PRESETS[key]}
                  onClick={() => setSizeNorm(SIZE_PRESETS[key])}
                  className={cn("h-12 flex-1 flex-col gap-1 rounded-lg px-0 py-1 font-normal", sizeNorm === SIZE_PRESETS[key] ? "bg-moon/60 text-ink" : "hover:bg-moon/30")}>
                  <span aria-hidden className="grid h-5 place-items-center"><span className="rounded-full bg-ink" style={{ width: 2 + index * 4, height: 2 + index * 4 }} /></span>
                  <span className="text-xs">{t(labelKey)}</span>
                </Button>
              );
            })}
          </div>
          <div aria-hidden className="mt-2 flex h-7 items-center px-1" style={swatchStyle}>
            <span className="w-full rounded-full" style={{ height: Math.max(1, sizeValue), backgroundColor: colorVar(color) }} />
          </div>
          <Slider aria-label={t("sizeAdjust")} aria-valuetext={t("sizeValue", { value: sizeValue.toFixed(1) })}
            value={[sizeValue]} min={0.5} max={SIZE_PRESETS.thick * 1000} step={0.1}
            onValueChange={([next]) => setSizeNorm(Math.round(next * 10) / 10_000)}
            className="h-11" thumbClassName="size-5" />
        </PopoverContent>
      </Popover>
      </div>

      <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <div
        role="group"
        data-tool-group="construction"
        aria-label={`${t("shape")} · ${t("instruments")}`}
        className={cn("flex shrink-0 items-center gap-0.5", !isRail && "rounded-xl bg-moon/20 p-0.5")}
      >
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("shape")} title={t("shape")} aria-pressed={tool === "shape"} className={cn("grid shrink-0 place-items-center rounded-full transition-colors", largeTargets ? "size-11" : "size-9", tool === "shape" ? "bg-moon/60 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink")}>
            <Shapes size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64 p-2">
          <div className="grid grid-cols-5 gap-1">
            {INSERT_SHAPES.map((shape) => (
              <button key={shape} type="button" aria-label={t(`shape_${shape}`)} title={t(`shape_${shape}`)} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-moon/40 hover:text-ink" onClick={() => { setShapeKind(shape); setTool("shape"); }}>
                <ShapeIcon shape={shape} />
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{t("shapeHint")}</p>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("instruments")} title={t("instruments")} className={cn("grid shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink", largeTargets ? "size-11" : "size-9")}>
            <Ruler size={18} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-48 p-1.5">
          <div className="flex flex-col gap-0.5">
            <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-moon/30" onClick={() => insertInstrument("ruler")}><Ruler size={16} />{t("ruler")}</button>
            <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-moon/30" onClick={() => insertInstrument("compass")}><DraftingCompass size={16} />{t("compass")}</button>
            <button type="button" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-moon/30" onClick={() => insertInstrument("protractor")}><ProtractorIcon size={16} />{t("protractor")}</button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={fillOpen} onOpenChange={setFillOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("fill")} title={t("fill")} className={cn("grid shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-moon/30 hover:text-ink", largeTargets ? "size-11" : "size-9")}><PaintBucket size={18} /></button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-64 p-3">
          <div className="grid grid-cols-4 gap-2">
            <button type="button" aria-label={t("fillNone")} title={t("fillNone")} aria-pressed={fill === null} onClick={() => pickFill(null)} className={cn("relative grid size-11 place-items-center rounded-full hover:bg-moon/30", fill === null && "ring-2 ring-crater")} style={swatchStyle}><span aria-hidden className="size-7 rounded-full border border-line bg-paper" /><span className="absolute inset-1/2 h-px w-6 -translate-x-1/2 -rotate-45 bg-rose" /></button>
            {COLOR_TOKENS.map((token) => (
              <button key={token} type="button" aria-label={colorNames(token)} title={colorNames(token)} aria-pressed={fill === token} onClick={() => pickFill(token)} className={cn("grid size-11 place-items-center rounded-full hover:bg-moon/30", fill === token && "ring-2 ring-crater")}>
                <span aria-hidden className="size-7 rounded-full border border-line" style={{ ...swatchStyle, background: colorVar(token) }} />
              </button>
            ))}
          </div>
          <CustomColorPicker key={fill ?? "none"} resolveInitialColor={() => resolveColor(paletteRef.current ?? document.documentElement, fill ?? color)}
            onApply={(next) => { pickFill(next); setFillOpen(false); }} />
        </PopoverContent>
      </Popover>
      </div>

      <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
      <ToolButton large={largeTargets} label={t("undo")} onClick={undo} disabled={!canUndo}><Undo2 size={18} /></ToolButton>
      <ToolButton large={largeTargets} label={t("clear")} onClick={() => setClearOpen(true)} disabled={clearTargets ? false : !hasItems}><Trash2 size={18} /></ToolButton>
      <ToolButton large={largeTargets} label={t("export")} onClick={() => { void exportPng(store.getState().items, title, paletteRef.current ?? document.documentElement); }} disabled={!hasItems}><Download size={18} /></ToolButton>
      {!isRail ? (
        <>
          <div aria-hidden className="mx-0.5 h-6 w-px shrink-0 bg-line" />
          <ToolButton large={largeTargets} label={t("hideToolbar")} onClick={() => setCollapsed(true)}><ChevronDown size={18} /></ToolButton>
        </>
      ) : null}

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("clear")}</DialogTitle>
            <DialogDescription>{clearTargets ? t("clearTargetsHint") : t("clearConfirm")}</DialogDescription>
          </DialogHeader>
          {clearTargets ? (
            <div className="space-y-0.5">
              {clearTargets.map((target) => <ClearTargetRow key={target.key} target={target} checked={clearSelected.has(target.key)} onToggle={() => setClearSelected((prev) => { const next = new Set(prev); if (next.has(target.key)) next.delete(target.key); else next.add(target.key); return next; })} />)}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setClearOpen(false)}>{t("cancel")}</Button>
            <Button size="sm" disabled={clearTargets ? clearSelected.size === 0 : false} onClick={() => { if (clearTargets) { for (const target of clearTargets) if (clearSelected.has(target.key)) target.store.getState().clear(); } else clear(); setClearOpen(false); }}>{t("clear")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
