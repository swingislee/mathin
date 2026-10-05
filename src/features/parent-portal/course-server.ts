import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { authorize, PortalError, readJson, requireResult, response } from "./server";
import { courseApplicationSchema, courseCommandSchema, courseOfferSchema } from "./course-contract";

export async function courseGet(request: Request) {
  const resource = new URL(request.url).searchParams.get("resource") || "catalog";
  if (resource === "catalog") {
    const { url, key } = getSupabaseConfig();
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const parsed = courseOfferSchema.array().safeParse(requireResult(await db.rpc("miniapp_course_catalog")));
    if (!parsed.success) throw new PortalError("UNAVAILABLE");
    return response(parsed.data);
  }
  if (resource !== "applications") throw new PortalError("NOT_FOUND");
  const { db } = await authorize(request);
  const parsed = courseApplicationSchema.array().safeParse(requireResult(await db.rpc("miniapp_course_applications")));
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  return response(parsed.data);
}

export async function coursePost(request: Request) {
  const value = courseCommandSchema.parse(await readJson(request));
  const { db } = await authorize(request);
  if (value.action === "cancel") {
    requireResult(await db.rpc("miniapp_cancel_course_application", { p_id: value.id }));
    return response({ ok: true });
  }
  const id = requireResult(await db.rpc("miniapp_apply_course", {
    p_id: value.id, p_publication_id: value.publicationId, p_revision: value.revision,
    p_classroom_id: value.classroomId, p_student_id: value.participantId,
  }));
  return response({ id }, 201);
}
