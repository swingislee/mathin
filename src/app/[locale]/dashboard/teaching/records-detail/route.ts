import { z } from "zod";
import { requireAnyPerm } from "@/lib/auth";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { getTeachingRecords } from "@/features/school/teaching-workbench/teaching-records-read";

const querySchema = z.object({
  sessionId: z.string().uuid(), contactPage: z.number().int().min(1).max(100000).default(1),
  pageSize: z.union([z.literal(10), z.literal(20)]).default(20),
});

/** 独立读取展开的课次；身份闸门和 RPC 范围与原实际记录页共用。 */
export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const started = performance.now();
  const { locale } = await params;
  await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const headers = { "Cache-Control": "private, no-store" };
  const input = querySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  try {
    const { sessionId, contactPage, pageSize } = input.data;
    const data = await getTeachingRecords(sessionId, contactPage, pageSize);
    return Response.json(data, { headers: { ...headers, "Server-Timing": `records;dur=${(performance.now() - started).toFixed(1)}` } });
  } catch {
    return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
