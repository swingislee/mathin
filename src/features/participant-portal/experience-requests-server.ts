import "server-only";
import { z } from "zod";
import { authorize, readJson, requireResult, response } from "@/features/parent-portal/server";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { experienceId } from "@/features/school/miniapp-settings/experience-schema";
import type { ExperienceRequest } from "../../../contracts/participant-api/experience-runtime";
import { experienceImages } from "./experience-server";
export const experienceAnswersSchema = z.record(experienceId, z.array(z.record(experienceId, z.union([z.string().max(4000), z.array(z.string().max(64)).max(30)]))).max(10));
export const experienceSubmissionSchema = z.object({ action: z.literal("submit"), id: z.string().uuid(), serviceId: z.union([experienceId, z.literal("")]),
  formId: experienceId, revision: z.number().int().positive(), answers: experienceAnswersSchema, participantIds: z.array(z.string().uuid()).max(10),
  consents: z.record(experienceId, z.string().min(1).max(100)) }).strict();
const command = z.discriminatedUnion("action", [experienceSubmissionSchema,
  z.object({ action: z.literal("cancel"), id: z.string().uuid(), version: z.number().int().positive() }).strict()]);
export async function experienceRequestsGet(request: Request) {
  const { db } = await authorize(request), page = z.coerce.number().int().min(1).max(1000).parse(new URL(request.url).searchParams.get("page") || 1);
  const rows = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_experience_requests", { p_page: page })) as ExperienceRequest[];
  const images = await experienceImages(db, rows.map(r => r.confirmation));
  return response(rows.map(r => ({ ...r, images })));
}
export async function experienceRequestsPost(request: Request) {
  const input = command.parse(await readJson(request)), { db } = await authorize(request);
  if (input.action === "cancel") return response(requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_update_experience_request", { p_id: input.id, p_version: input.version, p_status: "cancelled", p_note: "" })));
  // The database repeats answer, owner, publication and participant checks for direct RPC callers.
  // It also owns retry reconciliation, including a retry after the form has been republished.
  const receipt = requireResult(await (db.rpc as unknown as RegistrationRpc)("miniapp_submit_experience_request", {
    p_id: input.id, p_service_id: input.serviceId, p_form_id: input.formId, p_revision: input.revision,
    p_answers: input.answers, p_participant_ids: input.participantIds, p_consents: input.consents,
  })) as ExperienceRequest;
  return response({ ...receipt, images: await experienceImages(db, [receipt.confirmation]) }, 201);
}
