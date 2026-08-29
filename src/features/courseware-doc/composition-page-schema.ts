import { z } from "zod";
import {
  COURSEWARE_SNAP_GRID_COLUMNS,
  COURSEWARE_SNAP_GRID_ROWS,
  coursewareSnapGridPlacementsOverlap,
} from "./snap-grid";
import { gamePageDocSchema, type GamePageDoc } from "./game-page-schema";
import {
  microcourseCanvasSchema,
  microcourseSourceSnapshotSchema,
  type MicrocourseSourceSnapshot,
} from "./microcourse-schema";
import { pageDocSchema, type PageDoc } from "./schema";

export const COURSEWARE_COMPOSITION_DOC_VERSION = "courseware-composition-v1" as const;
export const COURSEWARE_COMPOSITION_LAYOUT_VERSION = "courseware-composition-grid-v1" as const;
export const COURSEWARE_COMPOSITION_MAX_BLOCKS = 8;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const blockIdSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const coursewareCompositionPlacementSchema = z.object({
  column: z.number().int().min(0).max(COURSEWARE_SNAP_GRID_COLUMNS - 1),
  row: z.number().int().min(0).max(COURSEWARE_SNAP_GRID_ROWS - 1),
  columnSpan: z.number().int().min(1).max(COURSEWARE_SNAP_GRID_COLUMNS),
  rowSpan: z.number().int().min(1).max(COURSEWARE_SNAP_GRID_ROWS),
}).strict();

const baseBlockSchema = z.object({
  id: blockIdSchema,
  placement: coursewareCompositionPlacementSchema,
});

const nodeBlockSchema = baseBlockSchema.extend({
  type: z.literal("node"),
  nodeId: z.string().min(1).max(200),
}).strict();

const gameBlockSchema = baseBlockSchema.extend({
  type: z.literal("game"),
  game: gamePageDocSchema,
}).strict();

export const coursewareCompositionH5Schema = z.object({
  artifactId: z.uuid(),
  sha256: sha256HexSchema,
  byteCount: z.number().int().nonnegative().max(5 * 1_024 * 1_024),
  entryPath: z.literal("index.html"),
}).strict();

const h5BlockSchema = baseBlockSchema.extend({
  type: z.literal("h5"),
  h5: coursewareCompositionH5Schema,
}).strict();

export const coursewareCompositionBlockSchema = z.discriminatedUnion("type", [
  nodeBlockSchema,
  gameBlockSchema,
  h5BlockSchema,
]);

export const coursewareCompositionLayoutSchema = z.object({
  version: z.literal(COURSEWARE_COMPOSITION_LAYOUT_VERSION),
  columns: z.literal(COURSEWARE_SNAP_GRID_COLUMNS),
  rows: z.literal(COURSEWARE_SNAP_GRID_ROWS),
  blocks: z.array(coursewareCompositionBlockSchema).max(COURSEWARE_COMPOSITION_MAX_BLOCKS),
}).strict().superRefine((layout, context) => {
  const ids = new Set<string>();
  let interactiveCount = 0;
  layout.blocks.forEach((block, index) => {
    if (ids.has(block.id)) {
      context.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "block ids must be unique" });
    }
    ids.add(block.id);
    if (block.type === "game" || block.type === "h5") interactiveCount += 1;
    const { placement } = block;
    if (placement.column + placement.columnSpan > COURSEWARE_SNAP_GRID_COLUMNS
      || placement.row + placement.rowSpan > COURSEWARE_SNAP_GRID_ROWS) {
      context.addIssue({ code: "custom", path: ["blocks", index, "placement"], message: "block exceeds composition grid" });
    }
    const minimum = block.type === "game"
      ? { columnSpan: 8, rowSpan: 6 }
      : block.type === "h5"
        ? { columnSpan: 4, rowSpan: 3 }
        : { columnSpan: 2, rowSpan: 1 };
    if (placement.columnSpan < minimum.columnSpan || placement.rowSpan < minimum.rowSpan) {
      context.addIssue({ code: "custom", path: ["blocks", index, "placement"], message: "block is smaller than its classroom minimum" });
    }
    if (block.type === "game" && block.game.layout && block.game.layout.blocks.length > 1) {
      context.addIssue({ code: "custom", path: ["blocks", index, "game", "layout"], message: "embedded games cannot contain a nested composition" });
    }
  });
  if (interactiveCount > 1) {
    context.addIssue({ code: "custom", path: ["blocks"], message: "a composition may contain only one authoritative interactive block" });
  }
  for (let left = 0; left < layout.blocks.length; left += 1) {
    for (let right = left + 1; right < layout.blocks.length; right += 1) {
      if (coursewareSnapGridPlacementsOverlap(
        layout.blocks[left].placement,
        layout.blocks[right].placement,
      )) {
        context.addIssue({ code: "custom", path: ["blocks", right, "placement"], message: "composition blocks cannot overlap" });
      }
    }
  }
});

export const coursewareCompositionPageSchema = z.object({
  docVersion: z.literal(COURSEWARE_COMPOSITION_DOC_VERSION),
  canvas: microcourseCanvasSchema,
  source: microcourseSourceSnapshotSchema.nullable(),
  /** Background belongs to the canvas/source; every teacher-owned foreground node is tiled. */
  overlay: pageDocSchema,
  layout: coursewareCompositionLayoutSchema,
}).strict().superRefine((doc, context) => {
  if (doc.overlay.canvas.width !== doc.canvas.width || doc.overlay.canvas.height !== doc.canvas.height) {
    context.addIssue({ code: "custom", path: ["overlay", "canvas"], message: "overlay canvas must match composition canvas" });
  }
  const topLevelNodeIds = doc.overlay.nodes.map((node) => node.id);
  const tiledNodeIds = doc.layout.blocks.flatMap((block) => (
    block.type === "node" ? [block.nodeId] : []
  ));
  const tiledSet = new Set(tiledNodeIds);
  topLevelNodeIds.forEach((nodeId, index) => {
    if (!tiledSet.has(nodeId)) {
      context.addIssue({ code: "custom", path: ["overlay", "nodes", index], message: "every foreground node must have a grid block" });
    }
  });
  tiledNodeIds.forEach((nodeId, index) => {
    if (!topLevelNodeIds.includes(nodeId) || tiledNodeIds.indexOf(nodeId) !== index) {
      context.addIssue({ code: "custom", path: ["layout", "blocks", index, "nodeId"], message: "node blocks must reference one unique top-level node" });
    }
  });
  if (new TextEncoder().encode(JSON.stringify(doc)).byteLength > 3 * 1_024 * 1_024) {
    context.addIssue({ code: "custom", path: [], message: "composition page exceeds the document size limit" });
  }
  if (doc.source && doc.layout.blocks.some((block) => block.type === "game" || block.type === "h5")) {
    context.addIssue({
      code: "custom",
      path: ["layout", "blocks"],
      message: "an immutable source page and an authored interaction cannot share one classroom state owner",
    });
  }
});

export type CoursewareCompositionPlacement = z.infer<typeof coursewareCompositionPlacementSchema>;
export type CoursewareCompositionBlock = z.infer<typeof coursewareCompositionBlockSchema>;
export type CoursewareCompositionLayout = z.infer<typeof coursewareCompositionLayoutSchema>;
export type CoursewareCompositionH5 = z.infer<typeof coursewareCompositionH5Schema>;
export type CoursewareCompositionPage = z.infer<typeof coursewareCompositionPageSchema>;

function emptyOverlay(): PageDoc {
  return {
    docVersion: "page-doc-v1",
    sourceCoursewareId: "teacher-composition-overlay",
    sourcePageId: null,
    sourcePageDatabaseId: 1,
    sourceSnapshotId: 1,
    sourceContentHash: "0".repeat(64),
    canvas: {
      width: 960,
      height: 720,
      backgroundColor: null,
      backgroundBindingKey: null,
    },
    nodes: [],
    interactions: [],
  };
}

export function createEmptyCoursewareCompositionPage(
  source: MicrocourseSourceSnapshot | null = null,
): CoursewareCompositionPage {
  return {
    docVersion: COURSEWARE_COMPOSITION_DOC_VERSION,
    canvas: { width: 960, height: 720, backgroundColor: "#ffffff" },
    source,
    overlay: emptyOverlay(),
    layout: {
      version: COURSEWARE_COMPOSITION_LAYOUT_VERSION,
      columns: COURSEWARE_SNAP_GRID_COLUMNS,
      rows: COURSEWARE_SNAP_GRID_ROWS,
      blocks: [],
    },
  };
}

export function isCoursewareCompositionPage(
  doc: { readonly docVersion: string },
): doc is CoursewareCompositionPage {
  return doc.docVersion === COURSEWARE_COMPOSITION_DOC_VERSION;
}

export type EmbeddedCompositionGame = GamePageDoc;
