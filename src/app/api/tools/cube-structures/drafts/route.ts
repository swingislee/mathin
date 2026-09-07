import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { CUBE_SAVED_DRAFT_MAX_BYTES, CubeDraftError, parseCubeDraftSnapshot, type CubeDraftErrorCode } from "@/features/tools/spatial-lab/cube-structures-draft";
import { cubeDraftSaveSchema } from "@/features/tools/spatial-lab/cube-structures-draft-store";

const headers = { "Cache-Control": "private, no-store" };
const status: Record<CubeDraftErrorCode, number> = { invalid: 400, version: 422, "too-large": 413, unavailable: 503, conflict: 409, missing: 404,
  "auth-required": 401, "account-security": 403, "account-changed": 409, limit: 422 };
function failure(error: unknown) {
  if (isRedirectError(error)) {
    const url = getURLFromRedirectError(error);
    const code = url?.includes("/login") ? "auth-required" : "account-security";
    return NextResponse.json({ code }, { status: status[code], headers });
  }
  const code = error instanceof CubeDraftError ? error.code : "unavailable";
  return NextResponse.json({ code }, { status: status[code], headers });
}
async function authorize(request: Request) {
  const user = await requireUser(request.headers.get("x-cube-locale") === "en" ? "en" : "zh");
  const expected = request.headers.get("x-cube-account");
  if (expected && expected !== user.id) throw new CubeDraftError("account-changed");
  return { user, supabase: await createClient() };
}
function dbFailure(error: { message: string; code: string }) {
  if (error.code === "42501") return new CubeDraftError("account-security");
  if (error.message === "CUBE_DRAFT_CONFLICT") return new CubeDraftError("conflict");
  if (error.message === "CUBE_DRAFT_MISSING") return new CubeDraftError("missing");
  if (error.message === "CUBE_DRAFT_LIMIT") return new CubeDraftError("limit");
  if (error.message === "CUBE_DRAFT_INVALID" || error.code === "23514") return new CubeDraftError("invalid");
  return new CubeDraftError("unavailable");
}
function metadata(row: { id: string; name: string; revision: number; created_at: string; updated_at: string }) {
  return { id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

/** 同时限制实际流字节数；Content-Length 只用于尽早拒绝，不能作为可信长度。 */
async function readBody(request: Request): Promise<unknown> {
  const limit = CUBE_SAVED_DRAFT_MAX_BYTES + 2048;
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new CubeDraftError("invalid");
  if (Number(request.headers.get("content-length")) > limit) throw new CubeDraftError("too-large");
  const reader = request.body?.getReader();
  if (!reader) throw new CubeDraftError("invalid");
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new CubeDraftError("too-large"); }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch (error) { throw error instanceof CubeDraftError ? error : new CubeDraftError("invalid"); }
  finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  try {
    const { user, supabase } = await authorize(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null) {
      if (!z.uuid().safeParse(id).success) throw new CubeDraftError("invalid");
      const { data, error } = await supabase.from("cube_structure_drafts").select("id,name,revision,created_at,updated_at,snapshot").eq("owner_id", user.id).eq("id", id).maybeSingle();
      if (error) throw dbFailure(error);
      if (!data) throw new CubeDraftError("missing");
      return NextResponse.json({ accountId: user.id, data: { ...metadata(data), snapshot: parseCubeDraftSnapshot(data.snapshot) } }, { headers });
    }
    const { data, error } = await supabase.from("cube_structure_drafts").select("id,name,revision,created_at,updated_at").eq("owner_id", user.id).order("updated_at", { ascending: false }).order("id").limit(200);
    if (error) throw dbFailure(error);
    return NextResponse.json({ accountId: user.id, data: data.map(metadata) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    // 浏览器 Cookie 写入口只接受本站请求，防止跨站提交。
    const origin = request.headers.get("origin");
    // Next 开发服务的内部 URL 可使用监听地址；浏览器实际目标由 Host 保留。
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host") ?? requestUrl.host;
    let originHost: string | null = null;
    try { if (origin && new URL(origin).protocol === requestUrl.protocol) originHost = new URL(origin).host; } catch { /* 无效来源按输入错误处理。 */ }
    if (!originHost || originHost !== host || request.headers.get("sec-fetch-site") === "cross-site") throw new CubeDraftError("invalid");
    const { user, supabase } = await authorize(request);
    if (request.headers.get("x-cube-account") !== user.id) throw new CubeDraftError("account-changed");
    const parsed = cubeDraftSaveSchema.safeParse(await readBody(request));
    if (!parsed.success) throw new CubeDraftError("invalid");
    const snapshot = parseCubeDraftSnapshot(parsed.data.snapshot);
    const { data, error } = await supabase.rpc("save_cube_structure_draft", {
      p_id: parsed.data.id, p_name: parsed.data.name, p_snapshot: snapshot as unknown as Json, p_expected_revision: parsed.data.expectedRevision,
    });
    if (error) throw dbFailure(error);
    return NextResponse.json({ accountId: user.id, data: { ...metadata(data), snapshot } }, { headers });
  } catch (error) { return failure(error); }
}
