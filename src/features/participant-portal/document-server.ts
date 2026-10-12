import "server-only";
import { z } from "zod";
import { readConsentDocuments, readPublishedDocument } from "@/features/parent-portal/policy-documents";
import { authorize, PortalError, readJson, requireResult, response } from "@/features/parent-portal/server";

export async function miniappDocumentGet(request: Request) {
  const query = new URL(request.url).searchParams;
  if (query.getAll("id").length !== 1 || query.getAll("version").length > 1) throw new PortalError("VALIDATION");
  const version = query.get("version") || undefined;
  if (version && version.length > 100) throw new PortalError("VALIDATION");
  const doc = await readPublishedDocument(query.get("id")!, version), tag = `"document-${doc.id}-${doc.version}"`;
  const headers = { "Cache-Control": "public, no-cache", ETag: tag, "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("if-none-match") === tag) return new Response(null, { status: 304, headers });
  return Response.json(doc, { headers });
}
export async function miniappConsentsGet() { return response(await readConsentDocuments()); }
export async function miniappConsentsPost(request: Request) {
  const v = z.object({ privacyVersion: z.string().min(1).max(100), childrenPrivacyVersion: z.string().min(1).max(100), consent: z.literal(true) }).strict().parse(await readJson(request));
  const { db } = await authorize(request, { allowMissingConsents: true });
  requireResult(await db.rpc("miniapp_accept_consent_documents", { p_privacy_version: v.privacyVersion, p_children_version: v.childrenPrivacyVersion }));
  return response({ ok: true });
}
