import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { courseApplicationSchema, courseOfferSchema } from "@/features/parent-portal/course-contract";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";

export async function getFamilySchedule(from: string, to: string) {
  const db = await createClient();
  // A staff member using the family view still reads only linked children's lessons.
  const { data, error } = await db.rpc("get_my_schedule", { p_from: from, p_to: to });
  if (error) throw new Error("FAMILY_SCHEDULE_UNAVAILABLE");
  return (data ?? []).map(row => ({
    id: row.session_id, studentId: row.student_id, studentName: row.student_name || "",
    classroom: row.classroom_name, title: row.lecture_name, at: row.scheduled_at,
    duration: row.duration_min, teacher: row.teacher_name || "",
  })).sort((a, b) => a.at.localeCompare(b.at));
}
export type FamilySession = Awaited<ReturnType<typeof getFamilySchedule>>[number];

export async function getFamilyRegistration() {
  const db = await createClient();
  const rpc = (db.rpc as unknown as RegistrationRpc).bind(db);
  const [catalog, applications] = await Promise.all([
    rpc("miniapp_registration_catalog"), rpc("miniapp_registration_applications"),
  ]);
  if (catalog.error || applications.error) throw new Error("FAMILY_REGISTRATION_UNAVAILABLE");
  return {
    offers: courseOfferSchema.array().parse(catalog.data).filter(row => row.kind === "class"),
    applications: courseApplicationSchema.array().parse(applications.data),
  };
}

const advisorSchema = z.object({ grade: z.number().int(), teacherName: z.string(), phone: z.string(), qrPath: z.string().regex(/^-?\d{1,2}\/[0-9a-f-]{36}\.(png|jpg|webp)$/) });
export async function getFamilyAdvisors() {
  const db = await createClient();
  const { data, error } = await (db.rpc as unknown as RegistrationRpc)("miniapp_advisor_contacts");
  if (error) throw new Error("FAMILY_CONTACTS_UNAVAILABLE");
  return advisorSchema.array().parse(data).map(({ qrPath, ...row }) => ({ ...row, qrCodeUrl: `/api/v1/parent/advisors/qr?path=${encodeURIComponent(qrPath)}` }));
}
