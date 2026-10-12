"use server";
import { z } from "zod";
import { newId } from "@/lib/uuid";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import type { MiniappSettings, MiniappContact } from "../../../../contracts/participant-api/miniapp-settings";
import { authorizedClient } from "../actions/guards";
import { miniappSettingsSchema, settingsStateSchema, type SettingsState } from "./contract";
import { prepareMiniappImage, prepareMiniappQrImage } from "./images";

const errors = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "FORM_CHANGED"];
async function rpcClient() {
  const { supabase } = await authorizedClient("organization.profile.manage");
  return { supabase, rpc: (supabase.rpc as unknown as RegistrationRpc).bind(supabase) };
}
export async function loadMiniappSettings(): Promise<ActionResult<SettingsState>> {
  try {
    const { rpc } = await rpcClient(), r = await rpc("miniapp_settings_workbench", {});
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: settingsStateSchema.parse(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function loadMiniappActivityChoices(): Promise<ActionResult<{ id: string; title: string }[]>> {
  try {
    const { rpc } = await rpcClient(), r = await rpc("miniapp_participant_activity_catalog", {});
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: z.array(z.object({ id: z.string().uuid(), title: z.string() })).parse(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function loadMiniappContactOptions(): Promise<ActionResult<{ campuses: { id: string; name: string }[]; legacy: MiniappContact[] }>> {
  try {
    const { rpc } = await rpcClient();
    const [campuses, legacy] = await Promise.all([rpc("miniapp_contact_campuses", {}), rpc("parent_advisor_settings", {})]);
    if (campuses.error || legacy.error) throw new Error(campuses.error?.message || legacy.error!.message);
    const rows = z.array(z.object({ grade: z.number().int(), teacherName: z.string(), phone: z.string(), qrPath: z.string(), enabled: z.boolean() })).parse(legacy.data);
    return { ok: true, data: { campuses: z.array(z.object({ id: z.string().uuid(), name: z.string() })).parse(campuses.data),
      legacy: rows.map(r => ({ id: `legacy-${r.grade}`, name: { zh: r.teacherName, en: "" }, service: { zh: "", en: "" }, phone: r.phone,
        qrImage: r.qrPath, stageNumbers: [r.grade], campusId: "", hours: { zh: "", en: "" }, address: { zh: "", en: "" }, visible: r.enabled })) } };
  } catch (error) { return actionError(error, errors); }
}
export async function saveMiniappSettings(config: MiniappSettings, revision: number, publish: boolean): Promise<ActionResult<SettingsState>> {
  try {
    const input = z.object({ config: miniappSettingsSchema, revision: z.number().int().nonnegative(), publish: z.boolean() }).safeParse({ config, revision, publish });
    if (!input.success) throw new Error("VALIDATION");
    const { rpc } = await rpcClient(), r = await rpc("save_miniapp_settings", { p_config: input.data.config, p_revision: revision, p_publish: publish });
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: settingsStateSchema.parse(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function restoreMiniappSettings(sourceRevision: number, revision: number): Promise<ActionResult<SettingsState>> {
  try {
    z.object({ sourceRevision: z.number().int().positive(), revision: z.number().int().nonnegative() }).parse({ sourceRevision, revision });
    const { rpc } = await rpcClient(), r = await rpc("restore_miniapp_settings", { p_source_revision: sourceRevision, p_revision: revision });
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: settingsStateSchema.parse(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function uploadMiniappImage(form: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    const { supabase } = await rpcClient(), file = form.get("image");
    if (!(file instanceof File)) throw new Error("VALIDATION");
    const images = await (form.get("kind") === "qr" ? prepareMiniappQrImage(file) : prepareMiniappImage(file)), id = newId(), path = `${id}.webp`;
    for (const [name, bytes] of [[path, images.display], [`${id}.thumb.webp`, images.thumbnail]] as const) {
      const r = await supabase.storage.from("miniapp-content-images").upload(name, bytes, { contentType: "image/webp", upsert: false });
      if (r.error) throw new Error(r.error.message);
    }
    return { ok: true, data: { path } };
  } catch (error) { return actionError(error, errors); }
}
