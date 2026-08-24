import type { WhiteboardStore } from "@/features/whiteboard/store";
import type { StrokeItem } from "@/features/whiteboard/types";

function rounded(value: number): number {
  return Number(value.toFixed(5));
}

/** Synthetic, deterministic, and PII-free: 500 strokes × 32 points. */
export function createM2AcceptanceStrokes(count = 500): StrokeItem[] {
  return Array.from({ length: count }, (_, strokeIndex) => {
    const column = strokeIndex % 20;
    const row = Math.floor(strokeIndex / 20);
    const baseX = 0.025 + column * 0.048;
    const baseY = 0.03 + row * 0.037;
    const points = Array.from({ length: 32 }, (_, pointIndex): [number, number] => {
      const progress = pointIndex / 31;
      return [
        rounded(Math.min(0.985, baseX + progress * 0.037)),
        rounded(Math.min(0.985, baseY + Math.sin(progress * Math.PI * 2 + strokeIndex * 0.17) * 0.008)),
      ];
    });
    return {
      id: `m2-fixture-${strokeIndex + 1}`,
      mode: "ink",
      color: strokeIndex === count - 1 ? "rose" : strokeIndex % 7 === 0 ? "blue" : "ink",
      wNorm: strokeIndex === count - 1 ? 0.009 : 0.0045,
      points,
    };
  });
}

/** Rehearsal-only fixture load: one full redraw and one checkpoint revision. */
export function loadM2AcceptanceFixture(store: WhiteboardStore): void {
  const items = createM2AcceptanceStrokes();
  store.setState((state) => {
    const revision = state.revision + 1;
    return {
      items,
      revision,
      renderMutation: { version: state.renderMutation.version + 1, kind: "full", items: [] },
      localMutation: { revision, ops: [{ t: "clear" }, { t: "restore", items }] },
      selectedIds: [],
      undoStack: [],
      outbox: [],
    };
  });
}
