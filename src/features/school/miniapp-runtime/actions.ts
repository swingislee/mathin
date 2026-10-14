"use server";
import { z } from "zod";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { authorizedClient } from "../actions/guards";
import { runtimeSpecSchema } from "@/features/participant-portal/runtime/spec";
import { previewRuntimeScreen, readPublishedRuntime } from "@/features/participant-portal/runtime/server";
import type { RuntimeScreen, RuntimeSpec, RuntimeTab } from "../../../../contracts/participant-api/runtime";
import type { MiniappSettings } from "../../../../contracts/participant-api/miniapp-settings";

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
/** Validates the draft and renders one screen as visitors, or as a signed-in family with example records. */
export async function previewMiniappRuntime(spec: RuntimeSpec, screen: string, mode: "visitor" | "member", locale: "zh" | "en", settings?: Pick<MiniappSettings, "brand" | "stages">):
  Promise<ActionResult<{ screen: RuntimeScreen; tabs: RuntimeTab[]; issues: string[] }>> {
  try {
    await authorizedClient("organization.profile.manage");
    const parsed = runtimeSpecSchema.safeParse(spec);
    const issues = parsed.success ? [] : parsed.error.issues.slice(0, 20).map(issue => issue.path.join(".") + " " + issue.message);
    const draft = settings ? draftSettingsSchema.safeParse(settings) : null;
    const value = await previewRuntimeScreen(parsed.success ? parsed.data : spec, screen, mode === "member" ? "member" : "visitor", locale === "en" ? "en" : "zh",
      draft?.success ? draft.data : undefined);
    return { ok: true, data: { ...value, issues } };
  } catch (error) { return actionError(error, errors); }
}
