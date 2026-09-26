import { requireUser } from "@/lib/auth";
import { materialQuerySchema } from "@/features/school/session-materials-contract";
import { getSessionMaterials } from "@/features/school/session-materials-read";

export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireUser(locale);
  const headers = { "Cache-Control": "private, no-store" };
  const input = materialQuerySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  try { return Response.json(await getSessionMaterials(input.data), { headers }); }
  catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return Response.json({ code: forbidden ? "FORBIDDEN" : "UNAVAILABLE" }, { status: forbidden ? 403 : 503, headers });
  }
}
