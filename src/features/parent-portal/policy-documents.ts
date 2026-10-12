import "server-only";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { requireResult } from "./server";
import { documentIdSchema, documentSchema } from "@/features/school/miniapp-settings/document-contract";
const policyTextSchema = z.object({ privacy: z.string().max(20000), children: z.string().max(20000) });
const policiesSchema = z.object({ privacyVersion: z.string(), childrenPrivacyVersion: z.string(), privacyPath: z.string(), childrenPrivacyPath: z.string(),
  policyText: z.object({ zh: policyTextSchema, en: policyTextSchema }) });
function client() { const { url, key } = getSupabaseConfig(); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
export async function readConsentDocuments() { return policiesSchema.parse(requireResult(await client().rpc("miniapp_consent_documents"))); }
export async function readPublishedDocument(id: string, version?: string) {
  return documentSchema.parse(requireResult(await client().rpc("miniapp_document", { p_id: documentIdSchema.parse(id), p_version: version })));
}
