import { z } from "zod";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { getClassSessionDetail } from "@/features/school/class-roster-session-read";

const querySchema = z.object({ sessionId: z.string().uuid(), classroomId: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const headers = { "Cache-Control": "private, no-store" };
  const input = querySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  try {
    const permissions = await getMyPerms(user.id);
    const data = await getClassSessionDetail(input.data.sessionId, input.data.classroomId, user.id, permissions.has("review.write"));
    return Response.json(data, { headers });
  } catch {
    return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
