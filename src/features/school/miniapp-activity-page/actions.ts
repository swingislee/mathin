"use server";

import { z } from "zod";
import { newId } from "@/lib/uuid";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "../actions/guards";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import type { ActivityPage } from "../../../../contracts/participant-api/activity-detail";
import { activityPageSchema, activityPageStateSchema, activityPageTargetSchema, pageImagePaths,
  type ActivityPageTarget, type ActivityPageState } from "./contract";

const errors = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "FORM_CHANGED"];
async function client(input: ActivityPageTarget) {
  const target = activityPageTargetSchema.parse(input);
  const { supabase } = await authorizedClient(target.kind === "activity" ? "activity.manage" : "class.manage");
  const rpc = (supabase.rpc as unknown as RegistrationRpc).bind(supabase);
  return { target, supabase, rpc };
}
export async function loadActivityPage(input: ActivityPageTarget): Promise<ActionResult<ActivityPageState>> {
  try {
    const { target, rpc } = await client(input);
    const result = await rpc("miniapp_activity_page_workbench", { p_kind: target.kind, p_target_id: target.targetId });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: activityPageStateSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function saveActivityPage(input: ActivityPageTarget & { page: ActivityPage; revision: number; publish: boolean }): Promise<ActionResult<ActivityPageState>> {
  try {
    const parsed = activityPageTargetSchema.extend({ page: activityPageSchema, revision: z.number().int().nonnegative(), publish: z.boolean() }).safeParse(input);
    if (!parsed.success) throw new Error("VALIDATION");
    const v = parsed.data, { target, rpc } = await client(v);
    if (pageImagePaths(v.page).some(path => !path.startsWith(`${target.kind}/${target.targetId}/`))) throw new Error("VALIDATION");
    const result = await rpc("save_miniapp_activity_page", { p_kind: target.kind, p_target_id: target.targetId,
      p_page: v.page, p_revision: v.revision, p_publish: v.publish });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: activityPageStateSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function uploadActivityPageImage(form: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    const { target, supabase, rpc } = await client({ kind: form.get("kind") as ActivityPageTarget["kind"], targetId: String(form.get("targetId") || "") });
    // Object-level authorization before accepting or storing file bytes.
    const access = await rpc("miniapp_activity_page_workbench", { p_kind: target.kind, p_target_id: target.targetId });
    if (access.error) throw new Error(access.error.message);
    const file = form.get("image");
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("VALIDATION");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = ext === "png" ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
      : ext === "jpg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : ext === "webp" && String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
    if (!valid) throw new Error("VALIDATION");
    const path = `${target.kind}/${target.targetId}/${newId()}.${ext}`;
    const result = await supabase.storage.from("miniapp-activity-images").upload(path, file, { contentType: file.type, upsert: false });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: { path } };
  } catch (error) { return actionError(error, errors); }
}
