"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { newId } from "@/lib/uuid";
import { authorizedClient, staffRpcClient } from "./actions/guards";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";
import { registrationIdSchema } from "@/features/parent-portal/course-contract";
import { formAnswerSnapshotSchema } from "@/features/parent-portal/form-questions";
import type { FormAnswerSnapshot } from "../../../contracts/participant-api/form-questions";

const publicationSchema = z.object({ kind: z.enum(["class", "activity"]), targetId: registrationIdSchema,
  title: z.string().trim().min(1).max(120), description: z.string().trim().max(4000),
  bookingClosesAt: z.string().datetime(), enabled: z.boolean(), revision: z.number().int().nonnegative() });
export type RegistrationPublicationInput = z.infer<typeof publicationSchema>;
const errors = ["FORBIDDEN", "UNAUTHENTICATED", "VALIDATION", "NOT_FOUND", "CONFLICT", "FORM_CHANGED", "BOOKING_CLOSED", "CLASS_NOT_AVAILABLE"];
function refresh() {
  revalidatePath("/[locale]/dashboard/classes", "layout");
  revalidatePath("/[locale]/dashboard/activities", "layout");
}
export async function loadRegistrationAnswers(id: string): Promise<ActionResult<FormAnswerSnapshot>> {
  try {
    const { supabase } = await staffRpcClient();
    const result = await (supabase.rpc as unknown as RegistrationRpc)("miniapp_registration_answers", { p_id: registrationIdSchema.parse(id) });
    if (result.error) throw new Error(result.error.message);
    return { ok: true, data: formAnswerSnapshotSchema.parse(result.data) };
  } catch (error) { return actionError(error, errors); }
}
export async function saveRegistrationPublication(input: RegistrationPublicationInput): Promise<ActionResult> {
  try {
    const v = publicationSchema.parse(input);
    const { supabase } = await authorizedClient(v.kind === "class" ? "class.manage" : "activity.manage");
    const { error } = await (supabase.rpc as unknown as RegistrationRpc)("save_parent_registration_publication", {
      p_kind: v.kind, p_target_id: v.targetId, p_title: v.title, p_description: v.description,
      p_booking_closes_at: v.bookingClosesAt, p_enabled: v.enabled, p_revision: v.revision,
    });
    if (error) throw new Error(error.message);
    refresh(); return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
export async function reviewRegistration(id: string, contacted: boolean, reply: string): Promise<ActionResult> {
  try {
    const v = z.object({ id: registrationIdSchema, contacted: z.boolean(), reply: z.string().trim().min(1).max(2000) }).parse({ id, contacted, reply });
    const { supabase } = await staffRpcClient();
    const { error } = await (supabase.rpc as unknown as RegistrationRpc)("review_parent_registration", { p_id: v.id, p_contacted: v.contacted, p_reply: v.reply });
    if (error) throw new Error(error.message);
    refresh(); return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
export async function saveAdvisorContact(form: FormData): Promise<ActionResult> {
  try {
    const { supabase } = await authorizedClient("organization.profile.manage");
    const v = z.object({ grade: z.coerce.number().int().min(-1).max(12), teacherName: z.string().trim().max(60),
      phone: z.string().trim().regex(/^\+?\d[\d -]{5,23}$/), qrPath: z.string(), enabled: z.boolean() })
      .parse({ grade: form.get("grade"), teacherName: form.get("teacherName"), phone: form.get("phone"), qrPath: form.get("qrPath") || "", enabled: form.get("enabled") === "true" });
    const file = form.get("qrFile");
    if (file instanceof File && file.size) {
      const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
      if (!ext || file.size > 1048576) throw new Error("VALIDATION");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const valid = ext === "png" ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
        : ext === "jpg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
      if (!valid) throw new Error("VALIDATION");
      v.qrPath = `${v.grade}/${newId()}.${ext}`;
      const { error } = await supabase.storage.from("parent-advisor-qrcodes").upload(v.qrPath, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(error.message);
    }
    if (!new RegExp(`^${v.grade}/[0-9a-f-]{36}\\.(png|jpg|webp)$`).test(v.qrPath)) throw new Error("VALIDATION");
    const { error } = await (supabase.rpc as unknown as RegistrationRpc)("save_parent_advisor_contact", {
      p_grade: v.grade, p_teacher_name: v.teacherName, p_phone: v.phone, p_qr_path: v.qrPath, p_enabled: v.enabled,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/[locale]/dashboard/organization/advisors", "page"); return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
