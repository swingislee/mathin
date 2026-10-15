"use server";
import { z } from "zod";
import { authorizedClient } from "../actions/guards";
import { actionError, type ActionResult } from "@/lib/action-result";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import type { ExperienceRequest } from "../../../../contracts/participant-api/experience-runtime";
const errors = ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "FORM_CHANGED", "CONFLICT"];
export async function loadExperienceRequests(page: number, status: string): Promise<ActionResult<ExperienceRequest[]>> {
  try { z.number().int().min(1).max(1000).parse(page); z.enum(["", "submitted", "confirmed", "completed", "cancelled", "declined"]).parse(status);
    const { supabase } = await authorizedClient("organization.profile.manage"), r = await (supabase.rpc as unknown as RegistrationRpc)("miniapp_experience_request_workbench", { p_page: page, p_status: status });
    if (r.error) throw new Error(r.error.message); return { ok: true, data: r.data as ExperienceRequest[] };
  } catch (e) { return actionError(e, errors); }
}
export async function updateExperienceRequest(id: string, version: number, status: string, note: string): Promise<ActionResult<ExperienceRequest>> {
  try { z.string().uuid().parse(id); z.number().int().positive().parse(version); z.enum(["confirmed", "completed", "cancelled", "declined"]).parse(status); z.string().max(2000).parse(note);
    const { supabase } = await authorizedClient("organization.profile.manage"), r = await (supabase.rpc as unknown as RegistrationRpc)("miniapp_update_experience_request", { p_id: id, p_version: version, p_status: status, p_note: note });
    if (r.error) throw new Error(r.error.message); return { ok: true, data: r.data as ExperienceRequest };
  } catch (e) { return actionError(e, errors); }
}
/** Short-lived links to files a family attached to a form. RLS lets staff who handle requests read them. */
export async function runtimeUploadLinks(ids: string[]): Promise<ActionResult<{ id: string; name: string; kind: string; url: string }[]>> {
  try { const list = z.array(z.string().uuid()).min(1).max(30).parse(ids);
    await authorizedClient("organization.profile.manage");
    const { createAdminClient } = await import("@/lib/supabase/admin"), admin = createAdminClient();
    const rows = await admin.from("miniapp_runtime_uploads").select("id,name,kind,object_path").in("id", list).eq("ready", true);
    if (rows.error) throw new Error(rows.error.message);
    const links = await Promise.all(((rows.data ?? []) as { id: string; name: string; kind: string; object_path: string }[]).map(async row => {
      const signed = await admin.storage.from("miniapp-runtime-uploads").createSignedUrl(row.object_path, 600);
      return { id: row.id, name: row.name, kind: row.kind, url: signed.data?.signedUrl ?? "" };
    }));
    return { ok: true, data: links.filter(row => row.url) };
  } catch (e) { return actionError(e, errors); }
}
