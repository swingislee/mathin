import { z } from "zod";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { getTeachingProgressMatrix } from "@/features/school/teaching-workbench/teaching-progress-matrix-read";

const querySchema = z.object({}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const headers = { "Cache-Control": "private, no-store" };
  if (!querySchema.safeParse(await request.json().catch(() => null)).success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  try {
    const permissions = await getMyPerms(user.id);
    const data = await getTeachingProgressMatrix({ userId: user.id, canViewTeam: permissions.has("class.view.all"), canReadCommunication: permissions.has("followup.view") });
    return Response.json(data, { headers });
  } catch {
    return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
