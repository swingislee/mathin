import { z } from "zod";
import { sha256HexSync } from "@/lib/sha256";

const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));

/** Tools 共用传输外壳；各工具只声明自身身份和状态，历史 wire 格式保持不变。 */
export function toolClassroomEventSchema<I extends string, V extends string, S extends z.ZodType>(
  toolId: I, contentVersion: V, state: S,
) {
  return z.object({
    schema: z.literal("mathin-classroom-tool-state"), version: z.literal(1),
    pageId: identifier, docId: identifier, instanceId: identifier,
    originHash: z.string().regex(/^[a-f0-9]{64}$/),
    toolId: z.literal(toolId), contentVersion: z.literal(contentVersion), state,
  }).strict();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** 固定副本决定实例命名空间；兼容局域网 HTTP，不依赖安全上下文。 */
export function toolSceneOriginHash(payload: unknown) {
  return sha256HexSync(new TextEncoder().encode(JSON.stringify(canonical(payload))));
}

export function toolSceneInstanceKey(docId: string, instanceId: string, originHash: string) {
  return `${docId}:${instanceId}:${originHash}`;
}
