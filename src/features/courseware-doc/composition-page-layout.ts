import type { DocNode } from "./schema";
import {
  resolveCoursewareSnapGridGesture,
  type CoursewareSnapGridSize,
  type CoursewareSnapGridTile,
} from "./snap-grid";
import {
  COURSEWARE_COMPOSITION_MAX_BLOCKS,
  coursewareCompositionPageSchema,
  type CoursewareCompositionBlock,
  type CoursewareCompositionH5,
  type CoursewareCompositionPage,
  type CoursewareCompositionPlacement,
  type CoursewareCompositionTool,
  type EmbeddedCompositionGame,
} from "./composition-page-schema";

const CELL_SIZE = 80;

function alternatives(block: CoursewareCompositionBlock): readonly CoursewareSnapGridSize[] {
  if (block.type === "game") {
    return [
      { columnSpan: 12, rowSpan: 9 },
      { columnSpan: 12, rowSpan: 6 },
      { columnSpan: 8, rowSpan: 9 },
      { columnSpan: 8, rowSpan: 6 },
      { columnSpan: 6, rowSpan: 9 },
      { columnSpan: 6, rowSpan: 6 },
      { columnSpan: 4, rowSpan: 9 },
      { columnSpan: 4, rowSpan: 6 },
      { columnSpan: 4, rowSpan: 4 },
    ];
  }
  if (block.type === "h5" || block.type === "tool") {
    return [
      { columnSpan: 12, rowSpan: 6 },
      { columnSpan: 8, rowSpan: 9 },
      { columnSpan: 8, rowSpan: 6 },
      { columnSpan: 6, rowSpan: 6 },
      { columnSpan: 4, rowSpan: 3 },
      { columnSpan: 2, rowSpan: 2 },
    ];
  }
  return [
    { columnSpan: 4, rowSpan: 9 },
    { columnSpan: 12, rowSpan: 3 },
    { columnSpan: 6, rowSpan: 3 },
    { columnSpan: 4, rowSpan: 3 },
    { columnSpan: 2, rowSpan: 2 },
    { columnSpan: 1, rowSpan: 1 },
  ];
}

function gridTile(block: CoursewareCompositionBlock): CoursewareSnapGridTile {
  return {
    id: block.id,
    placement: block.placement,
    minColumnSpan: block.type === "game" ? 4 : block.type === "h5" || block.type === "tool" ? 2 : 1,
    minRowSpan: block.type === "game" ? 4 : block.type === "h5" || block.type === "tool" ? 2 : 1,
    priority: block.type === "game" || block.type === "h5" || block.type === "tool" ? 0 : 10,
    alternativeSizes: alternatives(block),
  };
}

function applyPlacementToNode(node: DocNode, placement: CoursewareCompositionPlacement): void {
  node.transform.x = placement.column * CELL_SIZE;
  node.transform.y = placement.row * CELL_SIZE;
  node.transform.width = placement.columnSpan * CELL_SIZE;
  node.transform.height = placement.rowSpan * CELL_SIZE;
}

function applyResolved(
  input: CoursewareCompositionPage,
  resolved: readonly CoursewareCompositionPlacement[],
): CoursewareCompositionPage {
  const doc = structuredClone(input);
  doc.layout.blocks.forEach((block, index) => {
    block.placement = resolved[index];
    if (block.type !== "node") return;
    const node = doc.overlay.nodes.find((item) => item.id === block.nodeId);
    if (node) applyPlacementToNode(node, block.placement);
  });
  return coursewareCompositionPageSchema.parse(doc);
}

function appendBlock(
  input: CoursewareCompositionPage,
  block: CoursewareCompositionBlock,
): CoursewareCompositionPage {
  if (input.layout.blocks.length >= COURSEWARE_COMPOSITION_MAX_BLOCKS) return input;
  const doc = structuredClone(input);
  doc.layout.blocks.push(block);
  const resolved = resolveCoursewareSnapGridGesture(
    doc.layout.blocks.map(gridTile),
    block.id,
    block.placement,
  );
  return resolved ? applyResolved(doc, resolved) : input;
}

function nextBlockId(input: CoursewareCompositionPage, prefix: string): string {
  const ids = new Set(input.layout.blocks.map((block) => block.id));
  let sequence = 1;
  while (ids.has(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
}

export function updateCoursewareCompositionPlacement(
  input: CoursewareCompositionPage,
  blockId: string,
  placement: CoursewareCompositionPlacement,
): CoursewareCompositionPage {
  const resolved = resolveCoursewareSnapGridGesture(
    input.layout.blocks.map(gridTile),
    blockId,
    placement,
  );
  return resolved ? applyResolved(input, resolved) : input;
}

export function addCoursewareCompositionNode(
  input: CoursewareCompositionPage,
  node: DocNode,
  size: CoursewareSnapGridSize,
): CoursewareCompositionPage {
  if (input.layout.blocks.length >= COURSEWARE_COMPOSITION_MAX_BLOCKS
    || input.overlay.nodes.some((item) => item.id === node.id)) return input;
  const doc = structuredClone(input);
  const block: Extract<CoursewareCompositionBlock, { type: "node" }> = {
    id: `node-${node.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80),
    type: "node",
    nodeId: node.id,
    placement: { column: 0, row: 0, ...size },
  };
  if (doc.layout.blocks.some((item) => item.id === block.id)) return input;
  applyPlacementToNode(node, block.placement);
  doc.overlay.nodes.push(node);
  doc.layout.blocks.push(block);
  const resolved = resolveCoursewareSnapGridGesture(
    doc.layout.blocks.map(gridTile),
    block.id,
    block.placement,
  );
  return resolved ? applyResolved(doc, resolved) : input;
}

export function addCoursewareCompositionGame(
  input: CoursewareCompositionPage,
  game: EmbeddedCompositionGame,
): CoursewareCompositionPage {
  const embeddedGame = structuredClone(game);
  delete embeddedGame.layout;
  return appendBlock(input, {
    id: nextBlockId(input, "game"),
    type: "game",
    game: embeddedGame,
    placement: input.layout.blocks.length === 0
      ? { column: 0, row: 0, columnSpan: 12, rowSpan: 9 }
      : { column: 0, row: 0, columnSpan: 4, rowSpan: 4 },
  });
}

export function addCoursewareCompositionH5(
  input: CoursewareCompositionPage,
  h5: CoursewareCompositionH5,
): CoursewareCompositionPage {
  return appendBlock(input, {
    id: nextBlockId(input, "h5"),
    type: "h5",
    h5,
    placement: input.layout.blocks.length === 0
      ? { column: 0, row: 0, columnSpan: 12, rowSpan: 9 }
      : { column: 0, row: 0, columnSpan: 4, rowSpan: 3 },
  });
}

export function addCoursewareCompositionTool(
  input: CoursewareCompositionPage,
  tool: CoursewareCompositionTool,
): CoursewareCompositionPage {
  return appendBlock(input, {
    id: nextBlockId(input, "tool"),
    type: "tool",
    tool,
    placement: input.layout.blocks.length === 0
      ? { column: 0, row: 0, columnSpan: 12, rowSpan: 9 }
      : { column: 0, row: 0, columnSpan: 4, rowSpan: 3 },
  });
}

export function removeCoursewareCompositionBlock(
  input: CoursewareCompositionPage,
  blockId: string,
): CoursewareCompositionPage {
  const doc = structuredClone(input);
  const block = doc.layout.blocks.find((item) => item.id === blockId);
  if (!block) return input;
  doc.layout.blocks = doc.layout.blocks.filter((item) => item.id !== blockId);
  if (block.type === "node") {
    doc.overlay.nodes = doc.overlay.nodes.filter((node) => node.id !== block.nodeId);
  }
  return coursewareCompositionPageSchema.parse(doc);
}
