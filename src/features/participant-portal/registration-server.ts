import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorize, PortalError, readJson, requireResult, response } from "@/features/parent-portal/server";
import { needsFamilyOnboarding, policies, readFamilyForm } from "@/features/parent-portal/onboarding-server";
import { familyRegistrationSchema } from "@/features/parent-portal/onboarding-contract";
import type { RegistrationForm, RegistrationHistory, RegistrationSubmission } from "../../../contracts/participant-api/portal";
import { projectRegistration } from "./registration-projection";

const uuid = z.string().uuid();
const pageSize = 25;
const command = z.object({ id: uuid, family: familyRegistrationSchema.extend({ formVersion: z.number().int().positive() }) }).strict();
const submission = z.object({ id: uuid, participantId: uuid.nullable(), participantIds: z.array(uuid), grade: z.number().int().nullable() });

export async function registrationsGet(request: Request) {
  const { user, db } = await authorize(request);
  const owner = uuid.parse(user.id), query = new URL(request.url).searchParams;
  const resource = z.enum(["history", "form", "receipt"]).parse(query.get("resource") || "history");
  const admin = createAdminClient();
  if (resource === "receipt") {
    const id = uuid.parse(query.get("id"));
    const receipt = requireResult(await admin.from("miniapp_intakes").select("id")
      .eq("request_id", id).eq("intake_kind", "family_update").eq("registration_user_id", owner)
      .not("completed_at", "is", null).maybeSingle());
    return response(receipt);
  }
  if (resource === "form") {
    const [form, policy, original, participantRows] = await Promise.all([
      readFamilyForm(null), policies(),
      admin.from("miniapp_intakes").select("verified_phone,answers")
        .eq("registration_user_id", owner).eq("intake_kind", "family").not("completed_at", "is", null).maybeSingle(),
      db.rpc("get_my_students"),
    ]);
    const initial = requireResult(original);
    if (!initial) throw new PortalError("FORBIDDEN");
    const ids = z.array(z.object({ id: uuid })).parse(requireResult(participantRows) || []).map(row => row.id);
    const participants = ids.length ? requireResult(await admin.from("students").select("id,name,gender,grade,school")
      .in("id", ids).is("deleted_at", null).order("name")) || [] : [];
    const phone = initial.verified_phone || "";
    const saved = familyRegistrationSchema.safeParse(initial.answers);
    return response({ accountId: owner, form, ...policy, maskedPhone: phone ? phone.slice(0, 5) + "****" + phone.slice(-4) : "",
      existingParticipants: participants.map(row => ({ id: row.id, childName: row.name,
        gender: row.gender === "female" || row.gender === "male" ? row.gender : "", grade: row.grade, school: row.school || "" })),
      ...(saved.success ? { contact: { name: saved.data.parentName, relation: saved.data.relation } } : {}),
    } satisfies RegistrationForm);
  }
  const page = z.coerce.number().int().min(1).max(10000).parse(query.get("page") || "1");
  const [result, registrationRequired] = await Promise.all([
    admin.from("miniapp_intakes").select("id,intake_kind,created_at,completed_at,form_snapshot,answers")
      .or(`and(intake_kind.in.(family,family_update),registration_user_id.eq.${owner},completed_at.not.is.null),and(intake_kind.eq.generic,submitted_by.eq.${owner})`)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize),
    needsFamilyOnboarding(owner),
  ]);
  const rows = requireResult(result) || [];
  return response({ registrationRequired, records: rows.slice(0, pageSize).map(projectRegistration), hasMore: rows.length > pageSize } satisfies RegistrationHistory);
}

export async function registrationsPost(request: Request) {
  const { db } = await authorize(request);
  const input = command.parse(await readJson(request));
  // The transaction validates the current form for new submissions and replays a saved receipt unchanged.
  const saved = submission.parse(requireResult(await db.rpc("miniapp_submit_registration_update", {
    p_request_id: input.id, p_version: input.family.formVersion, p_answers: input.family,
  })));
  return response(saved satisfies RegistrationSubmission);
}
