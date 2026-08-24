import {
  COLOR_TOKENS,
  SHAPE_KINDS,
  type BoardItem,
} from "@/features/whiteboard/types";
import { CHECKPOINT_MAX_ITEMS } from "./limits";
import type { SessionBoardCheckpoint } from "./types";

const colors = new Set<string>(COLOR_TOKENS);
const shapes = new Set<string>(SHAPE_KINDS);

function numberBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isBoardItem(value: unknown): value is BoardItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || item.id.length < 1 || item.id.length > 64) return false;
  if (item.kind === "shape") {
    return typeof item.shape === "string" && shapes.has(item.shape)
      && typeof item.color === "string" && colors.has(item.color)
      && (item.fill === null || (typeof item.fill === "string" && colors.has(item.fill)))
      && numberBetween(item.strokeWidthNorm, 0.0005, 0.1)
      && numberBetween(item.x, -0.5, 1.5)
      && numberBetween(item.y, -0.5, 1.5)
      && numberBetween(item.width, 0.0005, 1.5)
      && numberBetween(item.height, 0.0005, 1.5)
      && numberBetween(item.rotation, -3600, 3600)
      && (item.startAngle === undefined || numberBetween(item.startAngle, -3600, 3600))
      && (item.sweepAngle === undefined || numberBetween(item.sweepAngle, -3600, 3600));
  }
  if ("kind" in item || (item.mode !== "ink" && item.mode !== "erase")
    || typeof item.color !== "string" || !colors.has(item.color)
    || !numberBetween(item.wNorm, 0.0005, 0.25)
    || !Array.isArray(item.points) || item.points.length < 1 || item.points.length > 4000) {
    return false;
  }
  return Array.from(item.points).every((point) => Array.isArray(point) && point.length === 2
    && numberBetween(point[0], -0.5, 1.5) && numberBetween(point[1], -0.5, 1.5));
}

export function parseBoardItems(value: unknown): BoardItem[] {
  if (!Array.isArray(value) || value.length > CHECKPOINT_MAX_ITEMS || !Array.from(value).every(isBoardItem)) {
    throw new Error("CHECKPOINT_ITEMS_INVALID");
  }
  return value;
}

export function flattenCheckpointChunks(value: unknown, itemCount: number): BoardItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64 || !Array.from(value).every(Array.isArray)) {
    throw new Error("CHECKPOINT_LOCAL_MANIFEST_MISMATCH");
  }
  const items = value.flat();
  if (items.length !== itemCount) throw new Error("CHECKPOINT_LOCAL_MANIFEST_MISMATCH");
  return parseBoardItems(items);
}

export function parseSessionBoardCheckpoints(value: unknown): SessionBoardCheckpoint[] {
  if (!Array.isArray(value)) throw new Error("CHECKPOINT_RESPONSE_INVALID");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("CHECKPOINT_RESPONSE_INVALID");
    const row = entry as Record<string, unknown>;
    const boardKey = typeof row.boardKey === "string" ? row.boardKey : "";
    const checkpointId = typeof row.checkpointId === "string" ? row.checkpointId : "";
    const createdAt = typeof row.createdAt === "string" && Number.isFinite(Date.parse(row.createdAt)) ? row.createdAt : "";
    const version = Number(row.version);
    const itemCount = Number(row.itemCount);
    const chunkCount = Number(row.chunkCount);
    const contentBytes = Number(row.contentBytes);
    if (!boardKey || !checkpointId || !createdAt
      || !Number.isSafeInteger(version) || version < 1
      || !Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > CHECKPOINT_MAX_ITEMS
      || !Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 64
      || !Number.isSafeInteger(contentBytes) || contentBytes < 2
      || !Array.isArray(row.items) || row.items.length !== itemCount) {
      throw new Error("CHECKPOINT_RESPONSE_INVALID");
    }
    const items = parseBoardItems(row.items);
    return {
      boardKey,
      checkpointId,
      createdAt,
      version,
      itemCount,
      chunkCount,
      contentBytes,
      items,
    };
  });
}
