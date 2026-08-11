import { z } from "zod";

export const UNIT_SQUARE_NET_VERSION = "unit-square-net-v1" as const;

export const UNIT_SQUARE_NET_LIMITS = {
  maxCells: 64,
  minCoordinate: -1_024,
  maxCoordinate: 1_024,
  maxSpan: 1_024,
} as const;

const coordinateSchema = z
  .number()
  .int()
  .min(UNIT_SQUARE_NET_LIMITS.minCoordinate)
  .max(UNIT_SQUARE_NET_LIMITS.maxCoordinate);

export const squareCellSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict();

export type SquareCell = z.infer<typeof squareCellSchema>;

export function compareSquareCells(left: SquareCell, right: SquareCell): number {
  return left.x - right.x || left.y - right.y;
}

export function squareCellKey(cell: SquareCell): string {
  return `${cell.x},${cell.y}`;
}

export const unitSquareNetSchema = z
  .object({
    netVersion: z.literal(UNIT_SQUARE_NET_VERSION),
    cells: z.array(squareCellSchema).min(1).max(UNIT_SQUARE_NET_LIMITS.maxCells),
  })
  .strict()
  .superRefine((net, context) => {
    const seen = new Set<string>();
    net.cells.forEach((cell, index) => {
      const key = squareCellKey(cell);
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: `duplicate square cell: ${key}`, path: ["cells", index] });
      }
      seen.add(key);
      if (index > 0 && compareSquareCells(net.cells[index - 1], cell) > 0) {
        context.addIssue({ code: "custom", message: "square cells must use stable coordinate order", path: ["cells"] });
      }
    });
    const xs = net.cells.map((cell) => cell.x);
    const ys = net.cells.map((cell) => cell.y);
    if (Math.max(...xs) - Math.min(...xs) > UNIT_SQUARE_NET_LIMITS.maxSpan) {
      context.addIssue({ code: "custom", message: "square net x span exceeds limit", path: ["cells"] });
    }
    if (Math.max(...ys) - Math.min(...ys) > UNIT_SQUARE_NET_LIMITS.maxSpan) {
      context.addIssue({ code: "custom", message: "square net y span exceeds limit", path: ["cells"] });
    }
  });

export type UnitSquareNet = z.infer<typeof unitSquareNetSchema>;

export function parseUnitSquareNet(input: unknown): UnitSquareNet {
  return unitSquareNetSchema.parse(input);
}

/** Creates a stable-order net without translating or otherwise changing its geometry. */
export function unitSquareNet(cells: readonly SquareCell[]): UnitSquareNet {
  return parseUnitSquareNet({
    netVersion: UNIT_SQUARE_NET_VERSION,
    cells: cells.map((cell) => ({ x: cell.x, y: cell.y })).sort(compareSquareCells),
  });
}
