"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import { createAdminClient } from "@/lib/supabase/admin";
import { gamePageDocSchema, type GamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { createDefaultGameCoursewarePayload } from "@/features/games/courseware/contracts";
import { gameCoursewareContractsForSurface } from "@/features/games/courseware/registry";
import { validateGameCoursewareContent } from "@/features/games/courseware/server";
import { teacherImageDimensions } from "@/features/teacher-microcourses/image-metadata";
import { microcourseH5Bytes } from "@/features/teacher-microcourses/h5";
import { authorizedClient, staffRpcClient } from "./actions/guards";
import { COMMON_CODES, parse, uuid } from "./actions/schemas";
import { homeworkScopeSchema } from "./homework-document-contract";
import { homeworkAssetLocation } from "./homework-interactive-assets";

const targetSchema = z.object({ scope: homeworkScopeSchema, targetId: uuid });
type Target = z.infer<typeof targetSchema>;
const imageSchema = targetSchema.extend({ file: z.instanceof(File).refine(file => ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) && file.size > 0 && file.size <= 10_485_760) });
const h5Schema = targetSchema.extend({ html: z.string().min(1).max(5_242_880) });
const gameSchema = targetSchema.extend({ gameId: z.string().min(1).max(100), contentVersion: z.string().min(1).max(100) });
const bindingSchema = z.string().regex(/^[0-9a-f]{64}$/);
async function authorizeTarget(target: Target) {
  const client = await authorizedClient(target.scope === "lecture" ? "courseware.review" : "review.write");
  const { data, error } = await client.supabase.rpc("can_access_homework_document", { p_scope: target.scope, p_target_id: target.targetId, p_uid: client.user.id, p_write: true });
  if (error || data !== true) throw new Error("FORBIDDEN");
  return client;
}
async function storeAsset(target: Target, bytes: Uint8Array, kind: "image" | "h5", mime: string, userId: string) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const bindingKey = createHash("sha256").update([userId, target.scope, target.targetId, kind, sha256].join(":")).digest("hex");
  const admin = createAdminClient();
  const location = homeworkAssetLocation({ kind, binding_key: bindingKey, sha256 });
  const { error: uploadError } = await admin.storage.from(location.bucket).upload(location.path, bytes, { contentType: mime, upsert: false });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error("UPLOAD_FAILED");
  const { error } = await admin.from("homework_assets").upsert({ binding_key: bindingKey, scope: target.scope, target_id: target.targetId, sha256, kind, created_by: userId }, { onConflict: "binding_key", ignoreDuplicates: true });
  if (error) throw new Error("UPLOAD_FAILED");
  const { data, error: signError } = await admin.storage.from(location.bucket).createSignedUrl(location.path, 3600);
  if (signError || !data) throw new Error("UPLOAD_FAILED");
  return { bindingKey, url: data.signedUrl };
}
export async function uploadHomeworkImage(input: Target & { file: File }): Promise<ActionResult<{ bindingKey: string; url: string }>> {
  try {
    const value = parse(imageSchema, input);
    const { user } = await authorizeTarget(value);
    const bytes = new Uint8Array(await value.file.arrayBuffer());
    if (!teacherImageDimensions(bytes, value.file.type)) throw new Error("VALIDATION");
    return { ok: true, data: await storeAsset(value, bytes, "image", value.file.type, user.id) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "UPLOAD_FAILED"]); }
}
export async function createHomeworkH5(input: Target & { html: string }): Promise<ActionResult<{ bindingKey: string; url: string }>> {
  try {
    const value = parse(h5Schema, input);
    const { user } = await authorizeTarget(value);
    return { ok: true, data: await storeAsset(value, microcourseH5Bytes(value.html), "h5", "text/html", user.id) };
  } catch (error) { return actionError(error, [...COMMON_CODES, "UPLOAD_FAILED", "H5_TOO_LARGE"]); }
}
export async function loadHomeworkH5(bindingKey: string): Promise<string> {
  const key = parse(bindingSchema, bindingKey);
  const { supabase } = await staffRpcClient();
  const { data: asset, error } = await supabase.from("homework_assets").select("binding_key,kind,sha256").eq("binding_key", key).eq("kind", "h5").single();
  if (error || !asset) throw new Error("FORBIDDEN");
  const location = homeworkAssetLocation(asset);
  const { data, error: downloadError } = await createAdminClient().storage.from(location.bucket).download(location.path);
  if (downloadError || !data) throw new Error("ASSET_UNAVAILABLE");
  return data.text();
}
export async function createHomeworkGame(input: Target & { gameId: string; contentVersion: string }): Promise<ActionResult<{ game: GamePageDoc }>> {
  try {
    const value = parse(gameSchema, input);
    await authorizeTarget(value);
    if (!gameCoursewareContractsForSurface("microcourse").some(c => c.gameId === value.gameId && c.contentVersion === value.contentVersion)) throw new Error("VALIDATION");
    const trusted = validateGameCoursewareContent(value.gameId, value.contentVersion, createDefaultGameCoursewarePayload(value.gameId, value.contentVersion));
    return { ok: true, data: { game: gamePageDocSchema.parse({ docVersion: "game-page-v1", canvas: { width: 960, height: 720, backgroundColor: "#ffffff" }, gameId: value.gameId, contentVersion: value.contentVersion, ...trusted }) } };
  } catch (error) { return actionError(error, COMMON_CODES); }
}
