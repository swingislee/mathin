"use server";

import { z } from "zod";
import { newId } from "@/lib/uuid";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "../actions/guards";
import { prepareMiniappImage } from "../miniapp-settings/images";
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
    if (!(file instanceof File)) throw new Error("VALIDATION");
    const { display, thumbnail } = await prepareMiniappImage(file), path = `${target.kind}/${target.targetId}/${newId()}.webp`;
    for (const [name, bytes] of [[path, display], [path.replace(/\.webp$/, ".thumb.webp"), thumbnail]] as const) {
      const result = await supabase.storage.from("miniapp-activity-images").upload(name, bytes, { contentType: "image/webp", upsert: false });
      if (result.error) throw new Error(result.error.message);
    }
    return { ok: true, data: { path } };
  } catch (error) { return actionError(error, errors); }
}
export async function restoreActivityPage(input: ActivityPageTarget & { sourceRevision: number; revision: number }): Promise<ActionResult<ActivityPageState>> {
  try {
    const v = activityPageTargetSchema.extend({ sourceRevision: z.number().int().positive(), revision: z.number().int().nonnegative() }).parse(input);
    const { target, rpc } = await client(v);
    const result = await rpc("restore_miniapp_activity_page", { p_kind: target.kind, p_target_id: target.targetId,
      p_source_revision: v.sourceRevision, p_revision: v.revision });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: activityPageStateSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
