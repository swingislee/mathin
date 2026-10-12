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
