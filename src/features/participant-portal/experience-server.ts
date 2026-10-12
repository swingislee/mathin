import "server-only";
import { z } from "zod";
import { authorize, PortalError, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { contentDocumentSchema, experienceFormSchema, experienceId, publicWebsiteUrl, webDestinationSchema } from "@/features/school/miniapp-settings/experience-schema";
import type { ContentDocument, ExperienceService } from "../../../contracts/participant-api/miniapp-experience";
import { miniappPublicClient, readPublishedSettings } from "./settings-server";
import { connectedProvider } from "./provider-transport";

export async function experienceClient(request: Request) {
  return request.headers.has("authorization") ? (await authorize(request)).db : miniappPublicClient();
}
export async function experienceDocument(request: Request, kind: "page" | "form" | "service" | "web", id: string) {
  const db = await experienceClient(request);
  const value = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_experience_document", { p_kind: kind, p_id: experienceId.parse(id) })) as { revision: number; document: unknown };
  return { db, value };
}
/** RLS authorizes each referenced image before issuing a short-lived URL, including protected pages. */
export async function experienceImages(db: Awaited<ReturnType<typeof experienceClient>>, documents: unknown[]): Promise<Record<string, string>> {
  const paths = new Set<string>();
  const scan = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(scan); return; }
    const row = v as Record<string, unknown>;
    if (typeof row.image === "string" && /^[0-9a-f-]{36}\.webp$/.test(row.image)) paths.add(row.image);
    Object.values(row).forEach(scan);
  };
  documents.forEach(scan);
  if (!paths.size) return {};
  const { data } = await db.storage.from("miniapp-content-images").createSignedUrls([...paths].slice(0, 200), 300);
  return Object.fromEntries((data || []).filter(v => v.path && v.signedUrl && !v.error).map(v => [v.path!, v.signedUrl!]));
}
export async function experienceGet(request: Request) {
  const query = new URL(request.url).searchParams;
  const kind = z.enum(["page", "form", "service", "web"]).parse(query.get("kind"));
  const id = experienceId.parse(query.get("id"));
  const { db, value } = await experienceDocument(request, kind, id);
  if (kind === "page" || kind === "form") {
    const document = kind === "page" ? contentDocumentSchema.parse(value.document) : experienceFormSchema.parse(value.document);
    return response({ revision: value.revision, document, images: await experienceImages(db, [document]) });
  }
  if (kind === "web") {
    const destination = webDestinationSchema.parse(value.document);
    if (!publicWebsiteUrl(destination.url) || destination.openMode === "webview" && !destination.domainConfirmed) throw new PortalError("NOT_FOUND");
    const url = new URL(destination.url);
    for (const key of destination.allowedParameters) {
      const v = key === "source" ? "miniapp" : query.get(key);
      if (v && (key !== "locale" || v === "zh" || v === "en") && /^[a-zA-Z0-9_-]{1,64}$/.test(v)) url.searchParams.set(key, v);
    }
    return response({ name: destination.name, url: url.href, openMode: destination.openMode, returnPageId: destination.returnPageId, unavailableMessage: destination.unavailableMessage });
  }
  const published = await readPublishedSettings(), experience = published.config?.experience;
  if (!experience || published.revision !== value.revision) throw new PortalError("FORM_CHANGED");
  const service = value.document as ExperienceService, flow = experience.flows.find(f => f.id === service.flowId) || null;
  const page = async (pageId?: string) => pageId ? contentDocumentSchema.parse((await experienceDocument(request, "page", pageId)).value.document) : null;
  const [content, preparation, form] = await Promise.all([page(service.detailPageId), page(flow?.preparationPageId),
    flow?.formId && request.headers.has("authorization") ? experienceDocument(request, "form", flow.formId).then(r => experienceFormSchema.parse(r.value.document)) : null]);
  let ready = service.binding.adapter === "mathin-assessment" || service.binding.adapter === "mathin-activity"
    || service.binding.adapter === "web" && experience.destinations.some(d => d.id === service.binding.target && d.enabled)
    || service.binding.adapter === "request";
  if (service.binding.adapter === "remote" && service.price.mode !== "online") {
    const connection = experience.connections.find(c => c.id === service.binding.connectionId);
    if (connection) try { await connectedProvider(connection, "booking.create", ["booking.v1", "policy.v1", "idempotency.v1"]); ready = true; } catch { ready = false; }
  }
  const resources = experience.resources.filter(r => r.enabled && service.resourceIds.includes(r.id));
  return response({ revision: value.revision, document: service, flow, policy: experience.policies.find(p => p.id === flow?.policyId) || null,
    content, preparation, form, resources, ready, unavailableMessage: { zh: "服务连接尚未完成，请联系服务人员。", en: "This service is not connected yet. Please contact us." },
    images: await experienceImages(db, [content, preparation, service, resources]) });
}

export function reportContentData(row: Record<string, unknown>) {
  return { report: { ...row, validity: row.referenceValidity }, participant: { name: row.participantName } };
}
export type ExperienceReportContent = { document: ContentDocument; images: Record<string, string> };
