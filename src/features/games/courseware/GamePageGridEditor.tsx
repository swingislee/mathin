"use client";

import { Grip, MoveDiagonal2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import { cn } from "@/lib/utils";
import GamePageStage from "./GamePageStage";
import {
  GAME_PAGE_GRID_COLUMNS,
  GAME_PAGE_GRID_ROWS,
  resolveGamePageGridLayout,
  updateGamePageGridPlacement,
  type GamePageGridLayout,
  type GamePageGridPlacement,
} from "./game-page-layout";

interface GridDrag {
  blockId: string;
  mode: "move" | "resize";
  pointerId: number;
  startX: number;
  startY: number;
  origin: GamePageGridPlacement;
}

export function GamePageGridEditor({
  doc,
  bindingUrls,
  selectedBlockId,
  onSelectBlock,
  onChange,
}: {
  doc: GamePageDoc;
  bindingUrls: ResolvedBindingUrls;
  selectedBlockId: string;
  onSelectBlock: (blockId: string) => void;
  onChange: (doc: GamePageDoc) => void;
}) {
  const t = useTranslations("teacherMicrocourses");
  const canvasRef = useRef<HTMLDivElement>(null);
  const layout = resolveGamePageGridLayout(doc.layout);
  const [drag, setDrag] = useState<GridDrag | null>(null);
  const [draftLayout, setDraftLayout] = useState<GamePageGridLayout | null>(null);
  const displayedLayout = drag && draftLayout ? draftLayout : layout;

  const begin = (
    event: PointerEvent<HTMLElement>,
    blockId: string,
    mode: GridDrag["mode"],
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const block = displayedLayout.blocks.find((item) => item.id === blockId);
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectBlock(blockId);
    setDraftLayout(displayedLayout);
    setDrag({
      blockId,
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: block.placement,
    });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || !canvasRef.current) return;
    event.preventDefault();
    const bounds = canvasRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const deltaColumn = Math.round((event.clientX - drag.startX) / (bounds.width / GAME_PAGE_GRID_COLUMNS));
    const deltaRow = Math.round((event.clientY - drag.startY) / (bounds.height / GAME_PAGE_GRID_ROWS));
    const origin = drag.origin;
    const placement: GamePageGridPlacement = drag.mode === "move"
      ? {
          ...origin,
          column: Math.max(0, Math.min(GAME_PAGE_GRID_COLUMNS - origin.columnSpan, origin.column + deltaColumn)),
          row: Math.max(0, Math.min(GAME_PAGE_GRID_ROWS - origin.rowSpan, origin.row + deltaRow)),
        }
      : {
          ...origin,
          columnSpan: Math.max(1, Math.min(GAME_PAGE_GRID_COLUMNS - origin.column, origin.columnSpan + deltaColumn)),
          rowSpan: Math.max(1, Math.min(GAME_PAGE_GRID_ROWS - origin.row, origin.rowSpan + deltaRow)),
        };
    setDraftLayout(updateGamePageGridPlacement(layout, drag.blockId, placement));
  };

  const finish = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (draftLayout && JSON.stringify(draftLayout.blocks) !== JSON.stringify(layout.blocks)) {
      onChange({ ...doc, layout: draftLayout });
    }
    setDrag(null);
    setDraftLayout(null);
  };

  const cancel = (event: PointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDrag(null);
    setDraftLayout(null);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, blockId: string) => {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta) return;
    const block = layout.blocks.find((item) => item.id === blockId);
    if (!block) return;
    event.preventDefault();
    const next = updateGamePageGridPlacement(layout, blockId, {
      ...block.placement,
      column: Math.max(0, Math.min(GAME_PAGE_GRID_COLUMNS - block.placement.columnSpan, block.placement.column + delta[0])),
      row: Math.max(0, Math.min(GAME_PAGE_GRID_ROWS - block.placement.rowSpan, block.placement.row + delta[1])),
    });
    if (next !== layout) onChange({ ...doc, layout: next });
  };

  return (
    <div
      ref={canvasRef}
      className="relative aspect-[4/3] w-full touch-none overflow-hidden bg-white"
      data-game-page-grid-editor
    >
      <GamePageStage doc={{ ...doc, layout: displayedLayout }} bindingUrls={bindingUrls} interactive={false} />
      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${GAME_PAGE_GRID_COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${GAME_PAGE_GRID_ROWS}, minmax(0, 1fr))`,
          backgroundImage: "linear-gradient(to right, rgb(111 139 72 / 0.16) 1px, transparent 1px), linear-gradient(to bottom, rgb(111 139 72 / 0.16) 1px, transparent 1px)",
          backgroundSize: `${100 / GAME_PAGE_GRID_COLUMNS}% ${100 / GAME_PAGE_GRID_ROWS}%`,
        }}
      >
        {displayedLayout.blocks.map((block) => {
          const selected = block.id === selectedBlockId;
          return (
            <div
              key={block.id}
              role="button"
              tabIndex={0}
              aria-label={t("gridMoveBlock", { type: t(`gridBlock_${block.type}`) })}
              aria-pressed={selected}
              className={cn(
                "group relative z-10 m-1 cursor-move rounded-xl border-2 bg-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-rose",
                selected ? "border-rose" : "border-transparent hover:border-crater/70",
                drag?.blockId === block.id && "border-rose-deep",
              )}
              style={{
                gridColumn: `${block.placement.column + 1} / span ${block.placement.columnSpan}`,
                gridRow: `${block.placement.row + 1} / span ${block.placement.rowSpan}`,
              }}
              onClick={() => onSelectBlock(block.id)}
              onKeyDown={(event) => moveWithKeyboard(event, block.id)}
              onPointerCancel={cancel}
              onPointerDown={(event) => begin(event, block.id, "move")}
              onPointerMove={move}
              onPointerUp={finish}
            >
              <span className={cn(
                "pointer-events-none absolute left-1 top-1 inline-flex items-center gap-1 rounded-full bg-ink/80 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity",
                (selected || drag?.blockId === block.id) && "opacity-100",
              )}>
                <Grip className="size-3" />
                {t(`gridBlock_${block.type}`)}
              </span>
              <button
                type="button"
                data-classroom-input="drag"
                aria-label={t("gridResizeBlock", { type: t(`gridBlock_${block.type}`) })}
                className={cn(
                  "absolute bottom-0 right-0 grid size-7 cursor-nwse-resize place-items-center rounded-tl-xl bg-rose text-white opacity-0 transition-opacity",
                  selected && "opacity-100",
                )}
                onPointerCancel={cancel}
                onPointerDown={(event) => begin(event, block.id, "resize")}
                onPointerMove={move}
                onPointerUp={finish}
              >
                <MoveDiagonal2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
