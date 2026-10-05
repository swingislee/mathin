import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { courseApplicationSchema, registrationIdSchema } from "@/features/parent-portal/course-contract";
import type { RegistrationRpc } from "@/features/parent-portal/course-server";

const workbenchSchema = z.object({
  name: z.string(), kind: z.enum(["class", "activity"]), targetId: registrationIdSchema, canPublish: z.boolean(), canReview: z.boolean(), publishable: z.boolean().default(true),
  publication: z.object({ title: z.string(), description: z.string(), bookingClosesAt: z.string().nullable().transform(v => v || new Date(Date.now() + 30 * 86400000).toISOString()), enabled: z.boolean(), revision: z.number().int() }),
  applications: courseApplicationSchema.array(),
});
export type RegistrationWorkbench = z.infer<typeof workbenchSchema>;
export async function loadRegistrationWorkbench(kind: "class" | "activity", targetId: string) {
  const db = await createClient();
  const { data, error } = await (db.rpc as unknown as RegistrationRpc)("parent_registration_workbench", { p_kind: kind, p_target_id: targetId });
  if (error) throw new Error(error.message);
  return workbenchSchema.parse(data);
}
const advisorSchema = z.object({ grade: z.number().int(), teacherName: z.string(), phone: z.string(), qrPath: z.string(), enabled: z.boolean() });
export type AdvisorSetting = z.infer<typeof advisorSchema> & { qrCodeUrl: string };
export async function loadAdvisorSettings(): Promise<AdvisorSetting[]> {
  const db = await createClient();
  const { data, error } = await (db.rpc as unknown as RegistrationRpc)("parent_advisor_settings");
  if (error) throw new Error(error.message);
  return advisorSchema.array().parse(data).map(row => ({ ...row, qrCodeUrl: `/api/v1/parent/advisors/qr?path=${encodeURIComponent(row.qrPath)}` }));
}
