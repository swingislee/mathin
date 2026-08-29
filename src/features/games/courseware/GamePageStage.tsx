"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { coursewareCanvasStyle } from "@/features/courseware-doc/courseware-surface";
import type { ResolvedBindingUrls } from "@/features/courseware-doc/resolve";
import type { GameMirrorState } from "../types";
import { resolveGamePageGridLayout } from "./game-page-layout";

const SudokuGamePageStage = dynamic(
  () => import("../sudoku/SudokuGamePageStage").then((module) => module.SudokuGamePageStage),
  { ssr: false },
);

export interface GamePageStageProps {
  doc: GamePageDoc;
  className?: string;
  interactive?: boolean;
  mirror?: GameMirrorState | null;
  onMirror?: (state: GameMirrorState) => void;
  bindingUrls?: ResolvedBindingUrls;
}

export default function GamePageStage({
  doc,
  className,
  interactive,
  mirror,
  onMirror,
  bindingUrls = {},
}: GamePageStageProps) {
  const layout = resolveGamePageGridLayout(doc.layout);
  const hasCompanions = layout.blocks.length > 1;
  return (
    <div
      className={cn("@container/game-page relative aspect-[4/3] w-full overflow-hidden", className)}
      data-game-page={doc.gameId}
      data-game-content-version={doc.contentVersion}
      data-game-page-layout={layout.version}
      data-classroom-input="native"
      style={coursewareCanvasStyle(doc.canvas.backgroundColor)}
    >
      <div
        className="grid size-full"
        style={{
          backgroundColor: doc.canvas.backgroundColor ?? "var(--paper)",
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
        }}
      >
        {layout.blocks.map((block) => {
          const placement = {
            gridColumn: `${block.placement.column + 1} / span ${block.placement.columnSpan}`,
            gridRow: `${block.placement.row + 1} / span ${block.placement.rowSpan}`,
          };
          if (block.type === "text") {
            return (
              <div key={block.id} className="min-h-0 min-w-0 p-1.5" style={placement}>
                <div className={cn(
                  "flex size-full overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-card p-[clamp(0.65rem,2cqw,1.5rem)] text-[clamp(0.8rem,2.25cqw,1.6rem)] leading-relaxed text-ink shadow-sm",
                  block.align === "center" ? "items-center justify-center text-center" : "items-start",
                )}>
                  {block.text}
                </div>
              </div>
            );
          }
          if (block.type === "image") {
            const src = bindingUrls[block.bindingKey];
            return (
              <div key={block.id} className="min-h-0 min-w-0 p-1.5" style={placement}>
                <div className="grid size-full place-items-center overflow-hidden rounded-xl border border-line bg-card shadow-sm">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- teacher courseware uses signed content-addressed URLs.
                    <img src={src} alt={block.alt} className={cn("size-full", block.fit === "cover" ? "object-cover" : "object-contain")} />
                  ) : (
                    <span className="px-3 text-center text-xs text-muted">{block.alt}</span>
                  )}
                </div>
              </div>
            );
          }
          return (
            <div key={block.id} className="min-h-0 min-w-0 overflow-hidden" style={placement}>
              {doc.gameId === "sudoku" && (
                doc.contentVersion === "sudoku-authored-v1"
                || doc.contentVersion === "sudoku-authored-v2"
              ) ? (
                <SudokuGamePageStage
                  doc={doc}
                  interactive={interactive}
                  mirror={mirror}
                  onMirror={onMirror}
                  compact={hasCompanions}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
