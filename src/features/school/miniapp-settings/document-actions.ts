"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "../actions/guards";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { documentContentSchema, documentIdSchema, documentIndexSchema, documentStateSchema, type DocumentContent, type DocumentIndex, type DocumentState } from "./document-contract";
const errors = ["FORBIDDEN", "UNAUTHENTICATED", "FORM_CHANGED", "VALIDATION", "NOT_FOUND"];
async function call(name: string, args: Record<string, unknown>) {
  const { supabase } = await authorizedClient("organization.profile.manage");
  const r = await (supabase.rpc as unknown as RegistrationRpc)(name, args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function loadMiniappDocuments(): Promise<ActionResult<DocumentIndex>> {
  try { return { ok: true, data: documentIndexSchema.parse(await call("miniapp_documents_index", {})) }; }
  catch (error) { return actionError(error, errors); }
}
export async function loadMiniappDocument(id: string): Promise<ActionResult<DocumentState>> {
  try { return { ok: true, data: documentStateSchema.parse(await call("miniapp_document_workbench", { p_id: documentIdSchema.parse(id) })) }; }
  catch (error) { return actionError(error, errors); }
}
export async function saveMiniappDocument(id: string, content: DocumentContent, revision: number, publish: boolean): Promise<ActionResult<DocumentState>> {
  try {
    const v = z.object({ id: documentIdSchema, content: documentContentSchema, revision: z.number().int().nonnegative(), publish: z.boolean() }).parse({ id, content, revision, publish });
    const data = documentStateSchema.parse(await call("save_miniapp_document", { p_id: v.id, p_content: v.content, p_revision: v.revision, p_publish: v.publish }));
    if (publish && ["privacy", "children_privacy"].includes(id)) { revalidatePath("/[locale]/privacy", "page"); revalidatePath("/[locale]/children-privacy", "page"); }
    return { ok: true, data };
  } catch (error) { return actionError(error, errors); }
}
export async function restoreMiniappDocument(id: string, sourceRevision: number, revision: number): Promise<ActionResult<DocumentState>> {
  try {
    const v = z.object({ id: documentIdSchema, sourceRevision: z.number().int().positive(), revision: z.number().int().positive() }).parse({ id, sourceRevision, revision });
    return { ok: true, data: documentStateSchema.parse(await call("restore_miniapp_document", { p_id: v.id, p_source_revision: v.sourceRevision, p_revision: v.revision })) };
  } catch (error) { return actionError(error, errors); }
}
