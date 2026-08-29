import { z } from "zod";
import {
  COURSEWARE_SNAP_GRID_COLUMNS,
  COURSEWARE_SNAP_GRID_ROWS,
  coursewareSnapGridPlacementsOverlap,
  resolveCoursewareSnapGridGesture,
} from "@/features/courseware-doc/snap-grid";

export const GAME_PAGE_GRID_VERSION = "game-page-grid-v1" as const;
export const GAME_PAGE_GRID_COLUMNS = COURSEWARE_SNAP_GRID_COLUMNS;
export const GAME_PAGE_GRID_ROWS = COURSEWARE_SNAP_GRID_ROWS;
export const GAME_PAGE_GRID_MAX_BLOCKS = 5;

const bindingKeySchema = z.string().regex(/^[0-9a-f]{64}$/);

export const gamePageGridPlacementSchema = z.object({
  column: z.number().int().min(0).max(GAME_PAGE_GRID_COLUMNS - 1),
  row: z.number().int().min(0).max(GAME_PAGE_GRID_ROWS - 1),
  columnSpan: z.number().int().min(1).max(GAME_PAGE_GRID_COLUMNS),
  rowSpan: z.number().int().min(1).max(GAME_PAGE_GRID_ROWS),
}).strict();

const baseBlockSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  placement: gamePageGridPlacementSchema,
});

const gameBlockSchema = baseBlockSchema.extend({
  type: z.literal("game"),
}).strict();

const textBlockSchema = baseBlockSchema.extend({
  type: z.literal("text"),
  text: z.string().max(4_000),
  align: z.enum(["left", "center"]),
}).strict();

const imageBlockSchema = baseBlockSchema.extend({
  type: z.literal("image"),
  bindingKey: bindingKeySchema,
  alt: z.string().max(200),
  fit: z.enum(["contain", "cover"]),
}).strict();

export const gamePageGridBlockSchema = z.discriminatedUnion("type", [
  gameBlockSchema,
  textBlockSchema,
  imageBlockSchema,
]);

export const gamePageGridLayoutSchema = z.object({
  version: z.literal(GAME_PAGE_GRID_VERSION),
  columns: z.literal(GAME_PAGE_GRID_COLUMNS),
  rows: z.literal(GAME_PAGE_GRID_ROWS),
  blocks: z.array(gamePageGridBlockSchema).min(1).max(GAME_PAGE_GRID_MAX_BLOCKS),
}).strict().superRefine((layout, context) => {
  const ids = new Set<string>();
  let gameCount = 0;
  layout.blocks.forEach((block, index) => {
    if (ids.has(block.id)) {
      context.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "block ids must be unique" });
    }
    ids.add(block.id);
    if (block.type === "game") gameCount += 1;
    const placement = block.placement;
    if (placement.column + placement.columnSpan > GAME_PAGE_GRID_COLUMNS) {
      context.addIssue({ code: "custom", path: ["blocks", index, "placement"], message: "block exceeds grid columns" });
    }
    if (placement.row + placement.rowSpan > GAME_PAGE_GRID_ROWS) {
      context.addIssue({ code: "custom", path: ["blocks", index, "placement"], message: "block exceeds grid rows" });
    }
    const minimum = block.type === "game"
      ? { columnSpan: 8, rowSpan: 6 }
      : { columnSpan: 2, rowSpan: 2 };
    if (placement.columnSpan < minimum.columnSpan || placement.rowSpan < minimum.rowSpan) {
      context.addIssue({ code: "custom", path: ["blocks", index, "placement"], message: "block is smaller than its usable classroom size" });
    }
  });
  if (gameCount !== 1) {
    context.addIssue({ code: "custom", path: ["blocks"], message: "layout must contain exactly one game block" });
  }
  for (let left = 0; left < layout.blocks.length; left += 1) {
    for (let right = left + 1; right < layout.blocks.length; right += 1) {
      if (placementsOverlap(layout.blocks[left].placement, layout.blocks[right].placement)) {
        context.addIssue({ code: "custom", path: ["blocks", right, "placement"], message: "blocks cannot overlap" });
      }
    }
  }
});

export type GamePageGridPlacement = z.infer<typeof gamePageGridPlacementSchema>;
export type GamePageGridBlock = z.infer<typeof gamePageGridBlockSchema>;
export type GamePageGridLayout = z.infer<typeof gamePageGridLayoutSchema>;
export type GamePageGridTemplate = "full" | "text-left" | "text-right" | "text-top" | "text-bottom";

export function defaultGamePageGridLayout(): GamePageGridLayout {
  return {
    version: GAME_PAGE_GRID_VERSION,
    columns: GAME_PAGE_GRID_COLUMNS,
    rows: GAME_PAGE_GRID_ROWS,
    blocks: [{
      id: "game",
      type: "game",
      placement: { column: 0, row: 0, columnSpan: 12, rowSpan: 9 },
    }],
  };
}

export function resolveGamePageGridLayout(layout: GamePageGridLayout | undefined): GamePageGridLayout {
  return layout ? structuredClone(layout) : defaultGamePageGridLayout();
}

export function placementsOverlap(left: GamePageGridPlacement, right: GamePageGridPlacement): boolean {
  return coursewareSnapGridPlacementsOverlap(left, right);
}

function distributedPlacements(
  count: number,
  axisLength: number,
  vertical: boolean,
  offsetColumn: number,
  offsetRow: number,
  crossSpan: number,
): GamePageGridPlacement[] {
  const base = Math.floor(axisLength / count);
  let remainder = axisLength % count;
  let cursor = 0;
  return Array.from({ length: count }, () => {
    const span = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    const placement = vertical
      ? { column: offsetColumn, row: offsetRow + cursor, columnSpan: crossSpan, rowSpan: span }
      : { column: offsetColumn + cursor, row: offsetRow, columnSpan: span, rowSpan: crossSpan };
    cursor += span;
    return placement;
  });
}

function nextTextBlock(layout: GamePageGridLayout): Extract<GamePageGridBlock, { type: "text" }> {
  let suffix = 1;
  while (layout.blocks.some((block) => block.id === `text-${suffix}`)) suffix += 1;
  return {
    id: `text-${suffix}`,
    type: "text",
    text: "",
    align: "left",
    placement: { column: 0, row: 0, columnSpan: 4, rowSpan: 9 },
  };
}

export function applyGamePageGridTemplate(
  input: GamePageGridLayout,
  template: GamePageGridTemplate,
  createCompanion = true,
): GamePageGridLayout {
  const layout = structuredClone(input);
  const game = layout.blocks.find((block): block is Extract<GamePageGridBlock, { type: "game" }> => block.type === "game");
  if (!game) return input;
  let companions = layout.blocks.filter((block) => block.type !== "game");
  if (template === "full") {
    if (companions.length > 0) return input;
    game.placement = { column: 0, row: 0, columnSpan: 12, rowSpan: 9 };
    return gamePageGridLayoutSchema.parse(layout);
  }
  if (companions.length === 0 && createCompanion) {
    const text = nextTextBlock(layout);
    layout.blocks.push(text);
    companions = [text];
  }
  if (companions.length === 0 || companions.length > 4) return input;

  let placements: GamePageGridPlacement[];
  if (template === "text-left" || template === "text-right") {
    const companionColumn = template === "text-left" ? 0 : 8;
    game.placement = { column: template === "text-left" ? 4 : 0, row: 0, columnSpan: 8, rowSpan: 9 };
    placements = distributedPlacements(companions.length, 9, true, companionColumn, 0, 4);
  } else {
    const companionRow = template === "text-top" ? 0 : 6;
    game.placement = { column: 0, row: template === "text-top" ? 3 : 0, columnSpan: 12, rowSpan: 6 };
    placements = distributedPlacements(companions.length, 12, false, 0, companionRow, 3);
  }
  companions.forEach((block, index) => { block.placement = placements[index]; });
  return gamePageGridLayoutSchema.parse(layout);
}

export function updateGamePageGridPlacement(
  input: GamePageGridLayout,
  blockId: string,
  placement: GamePageGridPlacement,
): GamePageGridLayout {
  const layout = structuredClone(input);
  const resolved = resolveCoursewareSnapGridGesture(
    layout.blocks.map((block) => ({
      id: block.id,
      placement: block.placement,
      minColumnSpan: block.type === "game" ? 8 : 2,
      minRowSpan: block.type === "game" ? 6 : 2,
      priority: block.type === "game" ? 0 : 10,
      alternativeSizes: block.type === "game"
        ? [
            { columnSpan: 12, rowSpan: 6 },
            { columnSpan: 8, rowSpan: 9 },
            { columnSpan: 8, rowSpan: 6 },
          ]
        : [
            { columnSpan: 4, rowSpan: 9 },
            { columnSpan: 12, rowSpan: 3 },
            { columnSpan: 6, rowSpan: 3 },
            { columnSpan: 4, rowSpan: 3 },
            { columnSpan: 2, rowSpan: 2 },
          ],
    })),
    blockId,
    placement,
  );
  if (!resolved) return input;
  layout.blocks.forEach((block, index) => { block.placement = resolved[index]; });
  const parsed = gamePageGridLayoutSchema.safeParse(layout);
  return parsed.success ? parsed.data : input;
}

export function addGamePageGridBlock(
  input: GamePageGridLayout,
  block: Extract<GamePageGridBlock, { type: "text" | "image" }>,
): GamePageGridLayout {
  if (input.blocks.length >= GAME_PAGE_GRID_MAX_BLOCKS || input.blocks.some((item) => item.id === block.id)) return input;
  const layout = structuredClone(input);
  layout.blocks.push(structuredClone(block));
  const game = layout.blocks.find((item) => item.type === "game");
  const template: GamePageGridTemplate = game?.placement.column === 0 && game.placement.columnSpan === 8
    ? "text-right"
    : game?.placement.row === 3
      ? "text-top"
      : game?.placement.row === 0 && game.placement.rowSpan === 6
        ? "text-bottom"
        : "text-left";
  return applyGamePageGridTemplate(layout, template, false);
}

export function removeGamePageGridBlock(input: GamePageGridLayout, blockId: string): GamePageGridLayout {
  const block = input.blocks.find((item) => item.id === blockId);
  if (!block || block.type === "game") return input;
  const layout = structuredClone(input);
  layout.blocks = layout.blocks.filter((item) => item.id !== blockId);
  if (layout.blocks.length === 1) return defaultGamePageGridLayout();
  const game = layout.blocks.find((item) => item.type === "game");
  const template: GamePageGridTemplate = game?.placement.column === 0 && game.placement.columnSpan === 8
    ? "text-right"
    : game?.placement.row === 3
      ? "text-top"
      : game?.placement.row === 0 && game.placement.rowSpan === 6
        ? "text-bottom"
        : "text-left";
  return applyGamePageGridTemplate(layout, template, false);
}
