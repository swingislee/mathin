"use server";
import { z } from "zod";
import { newId } from "@/lib/uuid";
import { experienceFormSchema } from "@/features/school/miniapp-settings/experience-schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { authorizedClient } from "../actions/guards";
import { runtimeSpecSchema } from "@/features/participant-portal/runtime/spec";
import { previewRuntimeScreen, readPublishedRuntime } from "@/features/participant-portal/runtime/server";
import type { RuntimeScreen, RuntimeSpec, RuntimeTab } from "../../../../contracts/participant-api/runtime";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";
import { miniappSettingsSchema } from "@/features/school/miniapp-settings/contract";

const errors = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "FORM_CHANGED"];
export type RuntimeWorkbench = {
  draft: RuntimeSpec; revision: number; publishedRevision: number | null; publishedAt: string | null; updatedAt: string | null;
  history: { revision: number; publishedAt: string }[];
  /** What clients currently receive: the last publication, or the current settings shown in runtime form. */
  live: RuntimeSpec; liveRevision: string; fromSettings: boolean;
};
const stateSchema = z.object({ draft: z.unknown(), revision: z.number().int().nonnegative(), publishedRevision: z.number().int().nullable(),
  publishedAt: z.string().nullable(), updatedAt: z.string().nullable().optional(),
  history: z.array(z.object({ revision: z.number().int(), publishedAt: z.string() })) }).passthrough();

async function rpc() {
  const { supabase } = await authorizedClient("organization.profile.manage");
  return (supabase.rpc as unknown as RegistrationRpc).bind(supabase);
}
async function workbench(value: unknown): Promise<RuntimeWorkbench> {
  const state = stateSchema.parse(value);
  const live = await readPublishedRuntime();
  const draft = runtimeSpecSchema.safeParse(state.draft);
  return {
    revision: state.revision, publishedRevision: state.publishedRevision, publishedAt: state.publishedAt, updatedAt: state.updatedAt ?? null, history: state.history,
    // Before the first save the editor starts from what clients currently receive.
    draft: draft.success ? draft.data : live.spec, fromSettings: live.revision.startsWith("s"), live: live.spec, liveRevision: live.revision,
  };
}

export async function loadMiniappRuntime(): Promise<ActionResult<RuntimeWorkbench>> {
  try {
    const r = await (await rpc())("miniapp_runtime_workbench", {});
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: await workbench(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function saveMiniappRuntime(spec: RuntimeSpec, revision: number, publish: boolean): Promise<ActionResult<RuntimeWorkbench>> {
  try {
    const input = z.object({ spec: runtimeSpecSchema, revision: z.number().int().nonnegative(), publish: z.boolean() }).safeParse({ spec, revision, publish });
    if (!input.success) throw new Error("VALIDATION");
    const r = await (await rpc())("save_miniapp_runtime", { p_spec: input.data.spec, p_revision: revision, p_publish: publish });
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: await workbench(r.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function restoreMiniappRuntime(sourceRevision: number, revision: number): Promise<ActionResult<RuntimeWorkbench>> {
  try {
    const r = await (await rpc())("restore_miniapp_runtime", { p_source_revision: sourceRevision, p_revision: revision });
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: await workbench(r.data) };
  } catch (error) { return actionError(error, errors); }
}
const localized = (limit: number) => z.object({ zh: z.string().max(limit), en: z.string().max(limit) }).strict();
/** The parts of the settings draft the runtime reads: name, theme and stage labels. */
const draftSettingsSchema = z.object({
  brand: z.object({ name: localized(60), introduction: localized(500), image: z.string().max(80), theme: z.enum(["paper", "leaf", "rose"]) }).strict(),
  stages: z.array(z.object({ id: z.string().max(64), label: localized(60), stages: z.array(z.object({ id: z.string().max(8),
    stageNumber: z.number().int().min(-1).max(12), label: localized(60), visible: z.boolean() }).strict()).max(14) }).strict()).min(1).max(14),
});
/** Validates the draft and renders one screen as visitors, or as a signed-in family with example records. Draft forms show on form blocks. */
export async function previewMiniappRuntime(spec: RuntimeSpec, screen: string, mode: "visitor" | "member", locale: "zh" | "en",
  settings?: Pick<MiniappSettings, "brand" | "stages"> & { forms?: unknown }):
  Promise<ActionResult<{ screen: RuntimeScreen; tabs: RuntimeTab[]; issues: string[] }>> {
  try {
    await authorizedClient("organization.profile.manage");
    const parsed = runtimeSpecSchema.safeParse(spec);
    const issues = parsed.success ? [] : parsed.error.issues.slice(0, 20).map(issue => issue.path.join(".") + " " + issue.message);
    const draft = settings ? draftSettingsSchema.safeParse({ brand: settings.brand, stages: settings.stages }) : null;
    const forms = settings?.forms ? z.array(experienceFormSchema).max(100).safeParse(settings.forms) : null;
    const value = await previewRuntimeScreen(parsed.success ? parsed.data : spec, screen, mode === "member" ? "member" : "visitor", locale === "en" ? "en" : "zh",
      draft?.success ? { ...draft.data, ...(forms?.success ? { forms: forms.data } : {}) } : undefined);
    return { ok: true, data: { ...value, issues } };
  } catch (error) { return actionError(error, errors); }
}

/** Audio (MP3, M4A) or video (MP4) for runtime pages. The file becomes public once a published page uses it. */
export async function uploadMiniappMedia(form: FormData): Promise<ActionResult<{ path: string }>> {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage"), file = form.get("media");
    if (!(file instanceof File) || !file.size || file.size > 16 * 1024 * 1024) throw new Error("VALIDATION");
    const bytes = new Uint8Array(await file.arrayBuffer()), ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    const brand = ascii(4, 8) === "ftyp" ? ascii(8, 12) : "";
    const kind = ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ? { ext: "mp3", type: "audio/mpeg" }
      : brand.startsWith("M4A") ? { ext: "m4a", type: "audio/mp4" }
      : ["isom", "iso2", "mp41", "mp42", "avc1", "M4V "].includes(brand) ? { ext: "mp4", type: "video/mp4" } : null;
    if (!kind) throw new Error("VALIDATION");
    const path = `${newId()}.${kind.ext}`;
    const stored = await supabase.storage.from("miniapp-content-media").upload(path, bytes, { contentType: kind.type, upsert: false });
    if (stored.error) throw new Error(stored.error.message);
    return { ok: true, data: { path } };
  } catch (error) { return actionError(error, errors); }
}

/** The complete published settings, which the public publication shortens. Null before the first publication. */
export async function loadPublishedMiniappSettings(): Promise<ActionResult<MiniappSettings | null>> {
  try {
    const r = await (await rpc())("miniapp_settings_published_config", {});
    if (r.error) throw new Error(r.error.message);
    return { ok: true, data: r.data ? miniappSettingsSchema.parse(r.data) : null };
  } catch (error) { return actionError(error, errors); }
}
