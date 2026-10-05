"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { actionError, type ActionResult } from "@/lib/action-result";
import { authorizedClient } from "./actions/guards";
import type { AdmissionsRpc } from "./parent-course-admissions";

const publicationInput = z.object({
  id: z.string().uuid().nullable(), title: z.string().trim().min(1).max(120), description: z.string().trim().max(4000),
  priceCents: z.number().int().nonnegative().nullable(), bookingClosesAt: z.string().datetime(), enabled: z.boolean(), classroomIds: z.array(z.string().uuid()).min(1).max(100),
});
export type PublicationInput = z.infer<typeof publicationInput>;
const errors = ["FORBIDDEN", "UNAUTHENTICATED", "VALIDATION", "CLASS_TARGET_MISMATCH", "NOT_FOUND", "CONFLICT", "CLASS_FULL", "ALREADY_ENROLLED_FOR_COURSE", "ENROLLMENT_ALREADY_ASSIGNED", "OPPORTUNITY_CLOSED", "COURSE_NOT_AVAILABLE", "CLASS_NOT_AVAILABLE", "OWNER_NOT_AVAILABLE"];
function refresh() {
  revalidatePath("/[locale]/dashboard/courses/admissions", "page");
  revalidatePath("/[locale]/dashboard/classes", "layout");
  revalidatePath("/[locale]/dashboard/communication", "page");
}
export async function saveCoursePublication(input: PublicationInput): Promise<ActionResult> {
  try {
    const v = publicationInput.parse(input);
    const { supabase } = await authorizedClient("course.manage");
    const { error } = await (supabase.rpc as unknown as AdmissionsRpc)("save_parent_course_publication", {
      p_id: v.id, p_title: v.title, p_description: v.description, p_price_cents: v.priceCents,
      p_booking_closes_at: v.bookingClosesAt, p_enabled: v.enabled, p_classroom_ids: v.classroomIds,
    });
    if (error) throw new Error(error.message);
    refresh(); return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
export async function reviewCourseApplication(id: string, confirm: boolean, reply: string): Promise<ActionResult> {
  try {
    const v = z.object({ id: z.string().uuid(), confirm: z.boolean(), reply: z.string().trim().min(1).max(2000) }).parse({ id, confirm, reply });
    const { supabase } = await authorizedClient("enrollment.manage");
    const { error } = await (supabase.rpc as unknown as AdmissionsRpc)("review_parent_course_application", { p_id: v.id, p_confirm: v.confirm, p_reply: v.reply });
    if (error) throw new Error(error.message);
    refresh(); return { ok: true };
  } catch (error) { return actionError(error, errors); }
}
