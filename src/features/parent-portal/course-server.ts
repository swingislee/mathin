import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { authorize, PortalError, readJson, requireResult, response } from "./server";
import { courseApplicationSchema, courseCommandSchema, courseOfferSchema } from "./course-contract";

export async function courseGet(request: Request, scope: "all" | "activity" | "participant" = "all") {
  const resource = new URL(request.url).searchParams.get("resource") || "catalog";
  if (resource === "catalog") {
    const { url, key } = getSupabaseConfig();
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const parsed = courseOfferSchema.array().safeParse(requireResult(await registrationRpc(db)(scope === "participant"
      ? "miniapp_participant_activity_catalog" : "miniapp_registration_catalog")));
    if (!parsed.success) throw new PortalError("UNAVAILABLE");
    return response(scope === "activity" ? parsed.data.filter(row => row.kind === "activity") : parsed.data);
  }
  if (resource !== "applications") throw new PortalError("NOT_FOUND");
  const { db } = await authorize(request);
  const parsed = courseApplicationSchema.array().safeParse(requireResult(await registrationRpc(db)(scope === "participant"
    ? "miniapp_participant_registration_applications" : "miniapp_registration_applications")));
  if (!parsed.success) throw new PortalError("UNAVAILABLE");
  return response(scope === "activity" ? parsed.data.filter(row => row.kind === "activity") : parsed.data);
}

export async function coursePost(request: Request, scope: "all" | "activity" | "participant" = "all") {
  const value = courseCommandSchema.parse(await readJson(request));
  if (scope !== "all" && value.action === "apply" && value.kind !== "activity") throw new PortalError("VALIDATION");
  const { db } = await authorize(request);
  if (value.action === "cancel") {
    if (scope === "activity") {
      const applications = courseApplicationSchema.array().safeParse(requireResult(await registrationRpc(db)("miniapp_registration_applications")));
      if (!applications.success) throw new PortalError("UNAVAILABLE");
      if (!applications.data.some(row => row.id === value.id && row.kind === "activity")) throw new PortalError("NOT_FOUND");
    }
    requireResult(await registrationRpc(db)(scope === "participant" ? "miniapp_participant_cancel_registration" : "miniapp_cancel_registration", { p_id: value.id }));
    return response({ ok: true });
  }
  const id = requireResult(await registrationRpc(db)(scope === "participant" ? "miniapp_participant_apply_registration" : "miniapp_apply_registration", {
    p_id: value.id, ...(scope === "participant" ? {} : { p_kind: value.kind }), p_target_id: value.publicationId, p_revision: value.revision, p_student_id: value.participantId,
  }));
  return response({ id }, 201);
}

export type RegistrationRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
function registrationRpc(db: { rpc: unknown }) { return (db.rpc as RegistrationRpc).bind(db); }
