import { isStrokeItem, type BoardItem, type StrokeItem } from "@/features/whiteboard/types";
import {
  CHECKPOINT_CHUNK_TARGET_BYTES,
  CHECKPOINT_MAX_CHUNKS,
  CHECKPOINT_MAX_ITEMS,
} from "./limits";
import type { PreparedBoardCheckpoint } from "./types";

export {
  CHECKPOINT_CHUNK_HARD_BYTES,
  CHECKPOINT_CHUNK_TARGET_BYTES,
  CHECKPOINT_WARNING_BYTES,
  CHECKPOINT_MAX_CHUNKS,
  CHECKPOINT_MAX_ITEMS,
} from "./limits";

const TOLERANCES = [0.00015, 0.0003, 0.0006, 0.0012, 0.0024, 0.0048, 0.0096];
const encoder = new TextEncoder();

export function utf8JsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function segmentDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/** Iterative Ramer-Douglas-Peucker; endpoints are never removed. */
export function resampleStrokePoints(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 2 || tolerance <= 0) return points.map((point) => [...point] as [number, number]);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [startIndex, endIndex] = stack.pop()!;
    let furthest = -1;
    let distance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const candidate = segmentDistance(points[index], points[startIndex], points[endIndex]);
      if (candidate > distance) {
        distance = candidate;
        furthest = index;
      }
    }
    if (furthest >= 0) {
      keep[furthest] = 1;
      stack.push([startIndex, furthest], [furthest, endIndex]);
    }
  }
  return points.filter((_, index) => keep[index]).map((point) => [...point] as [number, number]);
}

function resampleItem(item: BoardItem, tolerance: number): BoardItem {
  if (!isStrokeItem(item)) return { ...item };
  return { ...item, points: resampleStrokePoints(item.points, tolerance) } satisfies StrokeItem;
}

function fitSingleItem(item: BoardItem): BoardItem {
  if (utf8JsonBytes([item]) <= CHECKPOINT_CHUNK_TARGET_BYTES) return item;
  if (!isStrokeItem(item)) throw new Error("CHECKPOINT_ITEM_TOO_LARGE");
  for (const tolerance of TOLERANCES) {
    const candidate = resampleItem(item, tolerance);
    if (utf8JsonBytes([candidate]) <= CHECKPOINT_CHUNK_TARGET_BYTES) return candidate;
  }
  throw new Error("CHECKPOINT_ITEM_TOO_LARGE");
}

function makeChunks(items: BoardItem[]): BoardItem[][] {
  if (items.length === 0) return [[]];
  const chunks: BoardItem[][] = [];
  let current: BoardItem[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && utf8JsonBytes(candidate) > CHECKPOINT_CHUNK_TARGET_BYTES) {
      chunks.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function pointCount(items: BoardItem[]): number {
  return items.reduce((sum, item) => sum + (isStrokeItem(item) ? item.points.length : 0), 0);
}

export function buildBoardCheckpoint(items: BoardItem[]): PreparedBoardCheckpoint {
  if (items.length > CHECKPOINT_MAX_ITEMS) throw new Error("CHECKPOINT_TOO_MANY_ITEMS");
  const originalPointCount = pointCount(items);
  let prepared = items.map(fitSingleItem);
  let chunks = makeChunks(prepared);

  if (chunks.length > CHECKPOINT_MAX_CHUNKS) {
    for (const tolerance of TOLERANCES) {
      prepared = items.map((item) => fitSingleItem(resampleItem(item, tolerance)));
      chunks = makeChunks(prepared);
      if (chunks.length <= CHECKPOINT_MAX_CHUNKS) break;
    }
  }
  if (chunks.length > CHECKPOINT_MAX_CHUNKS) throw new Error("CHECKPOINT_TOO_MANY_CHUNKS");
  for (const chunk of chunks) {
    if (utf8JsonBytes(chunk) > CHECKPOINT_CHUNK_TARGET_BYTES) throw new Error("CHECKPOINT_CHUNK_TOO_LARGE");
  }

  const storedPointCount = pointCount(prepared);
  return {
    chunks,
    itemCount: prepared.length,
    contentBytes: chunks.reduce((sum, chunk) => sum + utf8JsonBytes(chunk), 0),
    originalPointCount,
    storedPointCount,
    resampled: storedPointCount < originalPointCount,
  };
}
