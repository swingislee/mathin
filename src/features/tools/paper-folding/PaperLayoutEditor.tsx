"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { paperSquareId, type PaperFoldingSnapshot } from "./contract";
import { paperFoldingMessages } from "./messages";

export function PaperLayoutEditor({ snapshot, locale, selected, disabled, onSelect, onAdd }: {
  snapshot: PaperFoldingSnapshot; locale: "zh" | "en"; selected: string | null; disabled?: boolean;
  onSelect: (id: string) => void; onAdd: (x: number, z: number) => void;
}) {
  const m = paperFoldingMessages(locale), squares = snapshot.squares;
  const minX = Math.min(...squares.map((square) => square.x)) - 1, maxX = Math.max(...squares.map((square) => square.x)) + 1;
  const minZ = Math.min(...squares.map((square) => square.z)) - 1, maxZ = Math.max(...squares.map((square) => square.z)) + 1;
  const columns = maxX - minX + 1, rows = maxZ - minZ + 1;
  return <div className="overflow-auto" data-paper-layout-editor>
    <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(24px, 1fr))`, minWidth: columns * 24 }}>
      {Array.from({ length: columns * rows }, (_, index) => {
        const x = minX + index % columns, z = minZ + Math.floor(index / columns), id = paperSquareId(x, z);
        const square = squares.find((item) => item.id === id);
        const adjacent = !square && squares.some((item) => Math.abs(item.x - x) + Math.abs(item.z - z) === 1);
        if (!square && !adjacent) return <span key={id} className="aspect-square" />;
        return <Button key={id} variant="ghost" className="aspect-square h-auto min-w-0 rounded-sm border border-line p-0 text-xs data-[empty=true]:border-dashed aria-pressed:ring-2 aria-pressed:ring-rose"
          data-empty={!square} disabled={disabled} aria-label={square ? m.square(square.label || square.id) : m.addAt(x, z)}
          aria-pressed={square ? selected === id : undefined} title={square ? m.square(square.label || square.id) : m.addAt(x, z)}
          style={square ? { backgroundColor: square.color, color: "var(--ink)" } : undefined}
          onClick={() => square ? onSelect(id) : onAdd(x, z)}>
          {square ? (snapshot.labelsVisible ? square.label : null) : <Plus className="size-3" aria-hidden />}
        </Button>;
      })}
    </div>
  </div>;
}
