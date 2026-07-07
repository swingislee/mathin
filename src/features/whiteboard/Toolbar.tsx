"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronUp,
  Download,
  Eraser,
  MousePointer2,
  Pencil,
  Scissors,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { colorVar, exportPng } from "./strokes";
import { SIZE_PRESETS, useWhiteboardStore } from "./store";
import { COLOR_TOKENS, type Tool } from "./types";

const ERASER_TOOLS: Tool[] = ["strokeEraser", "eraserS", "eraserM", "eraserL"];
const SIZE_ORDER = ["thin", "medium", "thick"] as const;
type SizeLabelKey = "sizeThin" | "sizeMedium" | "sizeThick";

function ToolButton({ active, label, onClick, disabled, children }: {
  active?: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
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
        "grid size-9 place-items-center rounded-full transition-colors",
        active ? "bg-moon/60 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
        disabled && "pointer-events-none opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function Toolbar({ title }: { title: string }) {
  const t = useTranslations("whiteboard.board.tools");
  const colorNames = useTranslations("whiteboard.board.colors");
  const tool = useWhiteboardStore((state) => state.tool);
  const color = useWhiteboardStore((state) => state.color);
  const sizeNorm = useWhiteboardStore((state) => state.sizeNorm);
  const canUndo = useWhiteboardStore((state) => state.undoStack.length > 0);
  const hasItems = useWhiteboardStore((state) => state.items.length > 0);
  const setTool = useWhiteboardStore((state) => state.setTool);
  const setColor = useWhiteboardStore((state) => state.setColor);
  const setSizeNorm = useWhiteboardStore((state) => state.setSizeNorm);
  const undo = useWhiteboardStore((state) => state.undo);
  const clear = useWhiteboardStore((state) => state.clear);
  const [lastEraser, setLastEraser] = useState<Tool>("strokeEraser");
  const [clearOpen, setClearOpen] = useState(false);
  const isEraser = ERASER_TOOLS.includes(tool);
  const sizeIndex = Math.max(SIZE_ORDER.findIndex((key) => SIZE_PRESETS[key] === sizeNorm), 0);

  const pickEraser = (next: Tool) => {
    setLastEraser(next);
    setTool(next);
  };

  return (
    <div className="flex items-center gap-0.5 rounded-2xl border border-line bg-paper/85 p-1.5 shadow-lg backdrop-blur select-none">
      <ToolButton active={tool === "pointer"} label={t("pointer")} onClick={() => setTool("pointer")}>
        <MousePointer2 size={18} />
      </ToolButton>
      <ToolButton active={tool === "pen"} label={t("pen")} onClick={() => setTool("pen")}>
        <Pencil size={18} />
      </ToolButton>

      {/* 橡皮组：主按钮回到上次用的橡皮，角标弹出四种 */}
      <Popover>
        <div className="flex items-center">
          <ToolButton active={isEraser} label={t("eraser")} onClick={() => setTool(lastEraser)}>
            <Eraser size={18} />
          </ToolButton>
          <PopoverTrigger asChild>
            <button type="button" aria-label={t("eraser")} className="-ml-1.5 rounded-full p-0.5 text-muted transition-colors hover:text-ink">
              <ChevronUp size={13} />
            </button>
          </PopoverTrigger>
        </div>
        <PopoverContent side="top" className="w-auto p-1.5">
          <div className="flex flex-col gap-0.5">
            {ERASER_TOOLS.map((eraser) => (
              <button
                key={eraser}
                type="button"
                onClick={() => pickEraser(eraser)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  tool === eraser ? "bg-moon/60 text-ink" : "text-muted hover:bg-moon/30 hover:text-ink",
                )}
              >
                {eraser === "strokeEraser" ? <Scissors size={15} /> : <Eraser size={15} />}
                {t(eraser)}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 颜色：设计系统六色 */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("color")} title={t("color")} className="grid size-9 place-items-center rounded-full transition-colors hover:bg-moon/30">
            <span aria-hidden className="size-4.5 rounded-full border border-line" style={{ background: colorVar(color) }} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-auto p-2">
          <div className="grid grid-cols-3 gap-2">
            {COLOR_TOKENS.map((token) => (
              <button
                key={token}
                type="button"
                aria-label={colorNames(token)}
                title={colorNames(token)}
                onClick={() => setColor(token)}
                className={cn(
                  "size-7 rounded-full border border-line transition-transform hover:scale-110",
                  color === token && "ring-2 ring-crater ring-offset-2 ring-offset-paper",
                )}
                style={{ background: colorVar(token) }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* 粗细：三档 */}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("size")} title={t("size")} className="grid size-9 place-items-center rounded-full text-ink transition-colors hover:bg-moon/30">
            <span aria-hidden className="rounded-full bg-current" style={{ width: 4 + sizeIndex * 3, height: 4 + sizeIndex * 3 }} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" className="w-auto p-1.5">
          <div className="flex items-center gap-1">
            {SIZE_ORDER.map((key, index) => {
              const labelKey = `size${key.charAt(0).toUpperCase()}${key.slice(1)}` as SizeLabelKey;
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={t(labelKey)}
                  title={t(labelKey)}
                  onClick={() => setSizeNorm(SIZE_PRESETS[key])}
                  className={cn(
                    "grid size-9 place-items-center rounded-lg transition-colors",
                    sizeNorm === SIZE_PRESETS[key] ? "bg-moon/60" : "hover:bg-moon/30",
                  )}
                >
                  <span className="rounded-full bg-ink" style={{ width: 4 + index * 4, height: 4 + index * 4 }} />
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <div aria-hidden className="mx-1 h-6 w-px bg-line" />

      <ToolButton label={t("undo")} onClick={undo} disabled={!canUndo}>
        <Undo2 size={18} />
      </ToolButton>
      <ToolButton label={t("clear")} onClick={() => setClearOpen(true)} disabled={!hasItems}>
        <Trash2 size={18} />
      </ToolButton>
      <ToolButton
        label={t("export")}
        onClick={() => exportPng(useWhiteboardStore.getState().items, title, document.documentElement)}
        disabled={!hasItems}
      >
        <Download size={18} />
      </ToolButton>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("clear")}</DialogTitle>
            <DialogDescription>{t("clearConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setClearOpen(false)}>{t("cancel")}</Button>
            <Button
              size="sm"
              onClick={() => {
                clear();
                setClearOpen(false);
              }}
            >
              {t("clear")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
