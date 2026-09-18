import { z } from "zod";
import { newId } from "@/lib/uuid";
import { parseToolScene, toolSceneCatalogId, type ToolScene } from "./contract";
import { TOOL_SCENE_DEFINITIONS } from "./registry";

export const toolDraftErrorCodes = ["invalid", "too-large", "unavailable", "conflict", "missing", "auth-required", "account-security", "account-changed", "limit"] as const;
export type ToolDraftErrorCode = (typeof toolDraftErrorCodes)[number];
export class ToolDraftError extends Error {
  constructor(readonly code: ToolDraftErrorCode) { super(code); }
}
export const toolDraftMetadataSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80), catalogId: z.enum(TOOL_SCENE_DEFINITIONS.map((item) => item.catalogId)),
  revision: z.number().int().positive(), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
}).strict();
export const toolDraftSaveSchema = z.object({ id: z.uuid(), expectedRevision: z.number().int().min(0).max(2147483646), scene: z.unknown() }).strict();
export type ToolDraftSummary = z.infer<typeof toolDraftMetadataSchema>;
export type ToolDraft = ToolDraftSummary & { scene: ToolScene };
export function readToolDraft(value: unknown): ToolDraft {
  const result = toolDraftMetadataSchema.extend({ scene: z.unknown() }).safeParse(value);
  if (!result.success) throw new ToolDraftError("invalid");
  try {
    const scene = parseToolScene(result.data.scene);
    if (toolSceneCatalogId(scene) !== result.data.catalogId || scene.payload.title !== result.data.name) throw new ToolDraftError("invalid");
    return { ...result.data, scene };
  }
  catch { throw new ToolDraftError("invalid"); }
}

/** 同一账号、同一套保存与并发协议；领域参数全部通过 ToolScene 校验。 */
export function createToolDraftStore({ fetcher = fetch, locale = "zh" }: { fetcher?: typeof fetch; locale?: "zh" | "en" } = {}) {
  let accountId: string | null = null;
  async function request(query = "", body?: unknown) {
    let response: Response; let value: unknown;
    try {
      response = await fetcher(`/api/tools/scenes${query}`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { "x-tool-locale": locale, ...(accountId ? { "x-tool-account": accountId } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      value = await response.json();
    } catch { throw new ToolDraftError("unavailable"); }
    if (!response.ok) {
      const result = z.object({ code: z.enum(toolDraftErrorCodes) }).safeParse(value);
      throw new ToolDraftError(result.success ? result.data.code : "unavailable");
    }
    const result = z.object({ accountId: z.uuid(), data: z.unknown() }).strict().safeParse(value);
    if (!result.success) throw new ToolDraftError("invalid");
    if (accountId && result.data.accountId !== accountId) throw new ToolDraftError("account-changed");
    accountId = result.data.accountId;
    return result.data.data;
  }
  return {
    async list() {
      const result = z.array(toolDraftMetadataSchema).max(200).safeParse(await request());
      if (!result.success) throw new ToolDraftError("invalid");
      return result.data;
    },
    async read(id: string) {
      if (!z.uuid().safeParse(id).success) throw new ToolDraftError("invalid");
      return readToolDraft(await request(`?id=${encodeURIComponent(id)}`));
    },
    async save(scene: ToolScene, current?: Pick<ToolDraftSummary, "id" | "revision">) {
      if (!accountId) throw new ToolDraftError("auth-required");
      const input = toolDraftSaveSchema.parse({ id: current?.id ?? newId(), expectedRevision: current?.revision ?? 0, scene: parseToolScene(scene) });
      return readToolDraft(await request("", input));
    },
  };
}
