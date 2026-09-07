import { z } from "zod";
import { newId } from "@/lib/uuid";
import { CUBE_DRAFT_NAME_MAX, CubeDraftError, parseCubeDraftSnapshot, type CubeDraftErrorCode, type CubeDraftSnapshot } from "./cube-structures-draft";

export const cubeDraftMetadataSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(CUBE_DRAFT_NAME_MAX), revision: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
});
export const cubeDraftSaveSchema = z.object({
  id: z.uuid(), name: cubeDraftMetadataSchema.shape.name,
  expectedRevision: z.number().int().min(0).max(2147483646), snapshot: z.unknown(),
}).strict();
export type CubeSavedDraftSummary = z.infer<typeof cubeDraftMetadataSchema>;
export type CubeSavedDraft = CubeSavedDraftSummary & { readonly snapshot: CubeDraftSnapshot };
export interface CubeDraftOverview {
  readonly drafts: readonly CubeSavedDraftSummary[];
  readonly lastOpenedId: string | null;
}
export interface CubeDraftStore {
  overview(): Promise<CubeDraftOverview>;
  read(id: string): Promise<CubeSavedDraft>;
  save(input: { readonly name: string; readonly snapshot: CubeDraftSnapshot; readonly id?: string; readonly expectedRevision?: number }): Promise<CubeSavedDraft>;
  remember(id: string | null): void;
}

export function readSavedCubeDraft(value: unknown): CubeSavedDraft {
  const metadata = cubeDraftMetadataSchema.safeParse(value);
  if (!metadata.success || !value || typeof value !== "object" || !("snapshot" in value)) throw new CubeDraftError("invalid");
  return { ...metadata.data, snapshot: parseCubeDraftSnapshot(value.snapshot) };
}
const failureCodes = new Set<CubeDraftErrorCode>(["invalid", "version", "too-large", "unavailable", "conflict", "missing", "auth-required", "account-security", "account-changed", "limit"]);

/** Cookie 鉴权的账号草稿 API；账号切换后要求重新加载，避免将旧账号内容另存到新账号。 */
export function createCubeDraftStore({ fetcher = fetch, locale = "zh", readUrl = () => new URL(window.location.href),
  replaceUrl = (url: URL) => window.history.replaceState(window.history.state, "", url) }: {
  fetcher?: typeof fetch; locale?: "zh" | "en"; readUrl?: () => URL; replaceUrl?: (url: URL) => void;
} = {}): CubeDraftStore {
  let accountId: string | null = null;
  async function request(query = "", body?: unknown) {
    let response: Response;
    let value: unknown;
    try {
      response = await fetcher(`/api/tools/cube-structures/drafts${query}`, {
        method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
        headers: { "x-cube-locale": locale, ...(accountId ? { "x-cube-account": accountId } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
      value = await response.json();
    } catch { throw new CubeDraftError("unavailable"); }
    if (!response.ok) {
      const code = value && typeof value === "object" && "code" in value ? value.code : null;
      throw new CubeDraftError(typeof code === "string" && failureCodes.has(code as CubeDraftErrorCode) ? code as CubeDraftErrorCode : "unavailable");
    }
    const envelope = z.object({ accountId: z.uuid(), data: z.unknown() }).safeParse(value);
    if (!envelope.success) throw new CubeDraftError("invalid");
    if (accountId && envelope.data.accountId !== accountId) throw new CubeDraftError("account-changed");
    accountId = envelope.data.accountId;
    return envelope.data.data;
  }
  const remember = (id: string | null) => {
    const url = readUrl();
    if (id) url.searchParams.set("cubeDraft", id); else url.searchParams.delete("cubeDraft");
    replaceUrl(url);
  };
  return {
    async overview() {
      const result = z.array(cubeDraftMetadataSchema).max(200).safeParse(await request());
      if (!result.success) throw new CubeDraftError("invalid");
      const selected = readUrl().searchParams.get("cubeDraft");
      return { drafts: result.data, lastOpenedId: result.data.some((draft) => draft.id === selected) ? selected : null };
    },
    async read(id) {
      if (!z.uuid().safeParse(id).success) throw new CubeDraftError("invalid");
      return readSavedCubeDraft(await request(`?id=${encodeURIComponent(id)}`));
    },
    async save(input) {
      if (!accountId) throw new CubeDraftError("auth-required");
      const parsed = cubeDraftSaveSchema.safeParse({ ...input, id: input.id ?? newId(), expectedRevision: input.id ? input.expectedRevision : 0 });
      if (!parsed.success) throw new CubeDraftError("invalid");
      return readSavedCubeDraft(await request("", { ...parsed.data, snapshot: parseCubeDraftSnapshot(input.snapshot) }));
    },
    remember,
  };
}
