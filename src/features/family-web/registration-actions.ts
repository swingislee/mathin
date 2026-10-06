"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardEnvironment } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { courseCommandSchema } from "@/features/parent-portal/course-contract";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";

export async function submitFamilyRegistration(locale: string, input: unknown): Promise<{ ok: true; id?: string } | { ok: false; code: string }> {
  if (locale !== "zh" && locale !== "en") return { ok: false, code: "VALIDATION" };
  await requireDashboardEnvironment(locale, ["family"]);
  const parsed = courseCommandSchema.safeParse(input);
  if (!parsed.success || parsed.data.action === "apply" && parsed.data.kind !== "class") return { ok: false, code: "VALIDATION" };
  const value = parsed.data;
  try {
    const db = await createClient();
    const rpc = (db.rpc as unknown as RegistrationRpc).bind(db);
    const result = value.action === "apply"
      ? await rpc("miniapp_apply_registration", { p_id: value.id, p_kind: "class", p_target_id: value.publicationId, p_revision: value.revision, p_student_id: value.participantId })
      : await rpc("miniapp_cancel_registration", { p_id: value.id });
    if (result.error) {
      const known = ["FORBIDDEN", "VALIDATION", "FORM_CHANGED", "CONFLICT", "BOOKING_CLOSED", "NOT_FOUND"];
      return { ok: false, code: known.includes(result.error.message) ? result.error.message : "UNAVAILABLE" };
    }
    if (value.action === "apply" && result.data !== value.id) return { ok: false, code: "UNAVAILABLE" };
    revalidatePath(`/${locale}/dashboard/registration`);
    return { ok: true, ...(value.action === "apply" ? { id: value.id } : {}) };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
