export const H5_POINTER_RUNTIME_VERSION = "3";
export const H5_POINTER_PROTOCOL_SCHEMA = "mathin-h5-pointer";
export const H5_POINTER_PROTOCOL_VERSION = 1;
export const H5_POINTER_FRAME_SOURCE = "mathin-h5-pointer";
export const H5_POINTER_PARENT_SOURCE = "mathin-classroom";
export const H5_POINTER_MAX_POINTS_PER_CHUNK = 64;
export const H5_POINTER_MAX_MESSAGES_PER_SECOND = 240;

export type H5PointerBridgeStatus = "disabled" | "pending" | "ready" | "incompatible" | "timeout";
export type H5PointerCapability = "click" | "drag" | "native" | "ink" | "unknown";

export interface H5PointerPoint {
  x: number;
  y: number;
}

interface H5PointerFrameMessageBase {
  source: typeof H5_POINTER_FRAME_SOURCE;
  schema: typeof H5_POINTER_PROTOCOL_SCHEMA;
  version: typeof H5_POINTER_PROTOCOL_VERSION;
  frameId: string;
  channelToken: string;
}

export type H5PointerFrameMessage = H5PointerFrameMessageBase & (
  | {
      type: "pointer_capabilities";
      providerSchema: string;
      providerVersion: number;
      defaultCapability: H5PointerCapability;
    }
  | { type: "pointer_pong" }
  | {
      type: "pointer_start";
      pointerId: number;
      pointerType: string;
      gestureToken: string;
      capability: H5PointerCapability;
      isPrimary: boolean;
      button: number;
      x: number;
      y: number;
    }
  | {
      type: "pointer_move" | "pointer_end";
      pointerId: number;
      gestureToken: string;
      chunkSeq: number;
      points: H5PointerPoint[];
    }
  | {
      type: "pointer_cancel";
      pointerId: number;
      gestureToken: string;
    }
);

export interface H5PointerBridgeHost {
  registerFrame(frameId: string, iframe: HTMLIFrameElement): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeId(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPointerId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2 ** 31 - 1;
}

function isChunkSeq(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2 ** 31 - 1;
}

function isCapability(value: unknown): value is H5PointerCapability {
  return value === "click" || value === "drag" || value === "native" || value === "ink" || value === "unknown";
}

function parsePoint(value: unknown): H5PointerPoint | null {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  if (value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
  return { x: value.x, y: value.y };
}

function parsePoints(value: unknown): H5PointerPoint[] | null {
  if (!Array.isArray(value) || value.length > H5_POINTER_MAX_POINTS_PER_CHUNK) return null;
  const points: H5PointerPoint[] = [];
  for (const candidate of value) {
    const point = parsePoint(candidate);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

/** Strict, allocation-bounded validation before a frame message reaches the router. */
export function parseH5PointerFrameMessage(value: unknown): H5PointerFrameMessage | null {
  if (!isRecord(value)
      || Object.keys(value).length > 20
      || value.source !== H5_POINTER_FRAME_SOURCE
      || value.schema !== H5_POINTER_PROTOCOL_SCHEMA
      || value.version !== H5_POINTER_PROTOCOL_VERSION
      || !isSafeId(value.frameId, 160)
      || !isSafeId(value.channelToken, 160)) return null;

  const base = {
    source: H5_POINTER_FRAME_SOURCE,
    schema: H5_POINTER_PROTOCOL_SCHEMA,
    version: H5_POINTER_PROTOCOL_VERSION,
    frameId: value.frameId,
    channelToken: value.channelToken,
  } as const;

  if (value.type === "pointer_capabilities") {
    if (!isSafeId(value.providerSchema, 80)
        || !Number.isInteger(value.providerVersion)
        || !isCapability(value.defaultCapability)) return null;
    return {
      ...base,
      type: value.type,
      providerSchema: value.providerSchema,
      providerVersion: Number(value.providerVersion),
      defaultCapability: value.defaultCapability,
    };
  }
  if (value.type === "pointer_pong") return { ...base, type: value.type };
  if (value.type === "pointer_start") {
    if (!isPointerId(value.pointerId)
        || !isSafeId(value.pointerType, 24)
        || !isSafeId(value.gestureToken, 200)
        || !isCapability(value.capability)
        || typeof value.isPrimary !== "boolean"
        || !Number.isInteger(value.button)
        || !isFiniteNumber(value.x)
        || !isFiniteNumber(value.y)
        || value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) return null;
    return {
      ...base,
      type: value.type,
      pointerId: value.pointerId,
      pointerType: value.pointerType,
      gestureToken: value.gestureToken,
      capability: value.capability,
      isPrimary: value.isPrimary,
      button: Number(value.button),
      x: value.x,
      y: value.y,
    };
  }
  if (value.type === "pointer_move" || value.type === "pointer_end") {
    const points = parsePoints(value.points);
    if (!isPointerId(value.pointerId)
        || !isSafeId(value.gestureToken, 200)
        || !isChunkSeq(value.chunkSeq)
        || !points) return null;
    return {
      ...base,
      type: value.type,
      pointerId: value.pointerId,
      gestureToken: value.gestureToken,
      chunkSeq: value.chunkSeq,
      points,
    };
  }
  if (value.type === "pointer_cancel") {
    if (!isPointerId(value.pointerId) || !isSafeId(value.gestureToken, 200)) return null;
    return {
      ...base,
      type: value.type,
      pointerId: value.pointerId,
      gestureToken: value.gestureToken,
    };
  }
  return null;
}

export function h5PointerParentMessage(
  type: "pointer_hello" | "pointer_ack" | "pointer_ping" | "pointer_mode",
  frameId: string,
  channelToken: string,
  extra: Record<string, unknown> = {},
) {
  return {
    source: H5_POINTER_PARENT_SOURCE,
    schema: H5_POINTER_PROTOCOL_SCHEMA,
    version: H5_POINTER_PROTOCOL_VERSION,
    type,
    frameId,
    channelToken,
    ...extra,
  } as const;
}

export function h5PointerGestureMessage(
  type: "pointer_takeover" | "pointer_abort",
  frameId: string,
  channelToken: string,
  gestureToken: string,
) {
  return {
    source: H5_POINTER_PARENT_SOURCE,
    schema: H5_POINTER_PROTOCOL_SCHEMA,
    version: H5_POINTER_PROTOCOL_VERSION,
    type,
    frameId,
    channelToken,
    gestureToken,
  } as const;
}
