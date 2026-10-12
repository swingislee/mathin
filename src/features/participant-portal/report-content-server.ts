import "server-only";
import { authorize, response } from "@/features/parent-portal/server";
import { contentDocumentSchema } from "@/features/school/miniapp-settings/experience-schema";
import { experienceImages } from "./experience-server";
export async function reportContentResponse(request: Request, result: Response) {
  if (!result.ok) return result;
  const rows = await result.json() as Record<string, unknown>[], { db } = await authorize(request);
  const documents = rows.map(r => r.contentDocument ? contentDocumentSchema.safeParse(r.contentDocument) : null);
  const images = await experienceImages(db, documents.filter(d => d?.success).map(d => d!.data));
  return response(rows.map((row, i) => ({ ...row, contentDocument: documents[i]?.success ? documents[i]!.data : null, contentImages: images })));
}
