import { z } from "zod";
import { requireAnyPerm } from "@/lib/auth";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { getClassSessionObservations } from "@/features/school/class-roster-session-read";
import { CLASS_SESSION_OBSERVATION_BATCH_SIZE } from "@/features/school/class-roster-session-contract";

const querySchema = z.object({ classroomId: z.string().uuid(), sessionIds: z.array(z.string().uuid()).min(1).max(CLASS_SESSION_OBSERVATION_BATCH_SIZE) });

export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const headers = { "Cache-Control": "private, no-store" };
  const input = querySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  try {
    const data = await getClassSessionObservations(input.data.classroomId, input.data.sessionIds);
    return Response.json(data, { headers });
  } catch {
    return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
