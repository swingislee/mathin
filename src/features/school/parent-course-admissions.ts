import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { catalogClassSchema, courseApplicationSchema } from "@/features/parent-portal/course-contract";

export const publicationSchema = z.object({
  id: z.string().uuid(), title: z.string(), description: z.string(), priceCents: z.number().nullable(),
  bookingClosesAt: z.string(), enabled: z.boolean(), classroomIds: z.array(z.string().uuid()),
});
const workbenchSchema = z.object({
  canPublish: z.boolean(), canConfirm: z.boolean(), classes: z.array(catalogClassSchema),
  publications: z.array(publicationSchema), applications: z.array(courseApplicationSchema),
});
export type AdmissionsWorkbench = z.infer<typeof workbenchSchema>;
export type CoursePublication = z.infer<typeof publicationSchema>;
export type AdmissionsRpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function loadParentCourseAdmissions(): Promise<AdmissionsWorkbench> {
  const db = await createClient();
  const { data, error } = await (db.rpc as unknown as AdmissionsRpc)("parent_course_admissions_workbench");
  if (error) throw new Error(error.message);
  return workbenchSchema.parse(data);
}
