import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { parseToolScene, TOOL_SCENE_MAX_BYTES } from "@/features/tools/scenes/contract";
import { toolDraftSaveSchema, ToolDraftError, type ToolDraftErrorCode } from "@/features/tools/scenes/draft-store";

const headers = { "Cache-Control": "private, no-store" };
const statuses: Record<ToolDraftErrorCode, number> = { invalid: 400, "too-large": 413, unavailable: 503, conflict: 409, missing: 404, "auth-required": 401, "account-security": 403, "account-changed": 409, limit: 422 };
function failure(error: unknown) {
  const code = isRedirectError(error) ? getURLFromRedirectError(error)?.includes("/login") ? "auth-required" : "account-security"
    : error instanceof ToolDraftError ? error.code : "unavailable";
  return NextResponse.json({ code }, { status: statuses[code], headers });
}
async function authorize(request: Request) {
  const user = await requireUser(request.headers.get("x-tool-locale") === "en" ? "en" : "zh");
  const expected = request.headers.get("x-tool-account");
  if (expected && expected !== user.id) throw new ToolDraftError("account-changed");
  return { user, supabase: await createClient() };
}
function dbFailure(error: { code: string; message: string }) {
  if (error.code === "42501") return new ToolDraftError("account-security");
  const codes: Record<string, ToolDraftErrorCode> = { TOOL_DRAFT_CONFLICT: "conflict", TOOL_DRAFT_MISSING: "missing", TOOL_DRAFT_LIMIT: "limit", TOOL_DRAFT_INVALID: "invalid" };
  const code = codes[error.message];
  return new ToolDraftError(code ?? (error.code === "23514" ? "invalid" : "unavailable"));
}
function metadata(row: { id: string; name: string; catalog_id: string; revision: number; created_at: string; updated_at: string }) {
  return { id: row.id, name: row.name, catalogId: row.catalog_id, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
function readScene(value: unknown) {
  try { return parseToolScene(value); } catch { throw new ToolDraftError("invalid"); }
}
async function readBody(request: Request) {
  const limit = TOOL_SCENE_MAX_BYTES + 2048;
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ToolDraftError("invalid");
  if (Number(request.headers.get("content-length")) > limit) throw new ToolDraftError("too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new ToolDraftError("invalid");
  let size = 0; let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ToolDraftError("too-large"); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch (error) { throw error instanceof ToolDraftError ? error : new ToolDraftError("invalid"); }
  finally { reader.releaseLock(); }
}
export async function GET(request: Request) {
  try {
    const { user, supabase } = await authorize(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      if (!z.uuid().safeParse(id).success) throw new ToolDraftError("invalid");
      const { data, error } = await supabase.from("tool_scene_drafts").select("id,name,catalog_id,revision,created_at,updated_at,scene").eq("owner_id", user.id).eq("id", id).maybeSingle();
      if (error) throw dbFailure(error);
      if (!data) throw new ToolDraftError("missing");
      return NextResponse.json({ accountId: user.id, data: { ...metadata(data), scene: readScene(data.scene) } }, { headers });
    }
    const { data, error } = await supabase.from("tool_scene_drafts").select("id,name,catalog_id,revision,created_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }).order("id").limit(200);
    if (error) throw dbFailure(error);
    return NextResponse.json({ accountId: user.id, data: data.map(metadata) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const url = new URL(request.url); const host = request.headers.get("host") ?? url.host;
    let origin: URL; try { origin = new URL(request.headers.get("origin") ?? ""); } catch { throw new ToolDraftError("invalid"); }
    if (origin.protocol !== url.protocol || origin.host !== host || request.headers.get("sec-fetch-site") === "cross-site") throw new ToolDraftError("invalid");
    const { user, supabase } = await authorize(request);
    if (request.headers.get("x-tool-account") !== user.id) throw new ToolDraftError("account-changed");
    const parsed = toolDraftSaveSchema.safeParse(await readBody(request));
    if (!parsed.success) throw new ToolDraftError("invalid");
    const scene = readScene(parsed.data.scene);
    const { data, error } = await supabase.rpc("save_tool_scene_draft", { p_id: parsed.data.id, p_scene: scene as unknown as Json, p_expected_revision: parsed.data.expectedRevision });
    if (error) throw dbFailure(error);
    return NextResponse.json({ accountId: user.id, data: { ...metadata(data), scene } }, { headers });
  } catch (error) { return failure(error); }
}
