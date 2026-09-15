import { z } from "zod";
import { getMyPerms, requireAnyPerm } from "@/lib/auth";
import { TEACHING_WORKBENCH_PERMISSIONS } from "@/features/school/teaching-workbench/teaching-workbench-access";
import { getTeachingRecords } from "@/features/school/teaching-workbench/teaching-records-read";
import { TEACHING_REPLAY_ID, selectTeachingReplay, teachingReplayAllowed, teachingReplayDetail } from "@/features/school/teaching-workbench/teaching-replay-contract";
import { readTeachingReplay } from "@/features/school/teaching-workbench/teaching-replay-read";

const querySchema = z.object({
  sessionId: z.string().uuid(), contactPage: z.number().int().min(1).max(100000).default(1),
  pageSize: z.union([z.literal(10), z.literal(20)]).default(20),
  replayId: z.literal(TEACHING_REPLAY_ID).optional(),
  replayFrom: z.string().datetime({ offset: true }).optional(), replayTo: z.string().datetime({ offset: true }).optional(),
}).refine(value => (!value.replayFrom && !value.replayTo) || Boolean(value.replayId && value.replayFrom && value.replayTo && Date.parse(value.replayTo) > Date.parse(value.replayFrom) && Date.parse(value.replayTo) - Date.parse(value.replayFrom) <= 366 * 86400000));

/** 独立读取展开的课次；身份闸门和 RPC 范围与原实际记录页共用。 */
export async function POST(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const started = performance.now();
  const { locale } = await params;
  const user = await requireAnyPerm(locale, TEACHING_WORKBENCH_PERMISSIONS);
  const headers = { "Cache-Control": "private, no-store" };
  const input = querySchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  if (input.data.replayId && !teachingReplayAllowed(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL, await getMyPerms(user.id))) {
    return Response.json({ code: "FORBIDDEN" }, { status: 403, headers });
  }
  try {
    const { sessionId, contactPage, pageSize, replayId, replayFrom, replayTo } = input.data;
    const source = replayId ? await readTeachingReplay(locale) : null;
    const snapshot = source && replayFrom && replayTo ? selectTeachingReplay(source, { start: replayFrom, end: replayTo }).snapshot : source;
    if (snapshot && !snapshot.sessions.some(session => session.id === sessionId)) return Response.json({ code: "NOT_FOUND" }, { status: 404, headers });
    const data = snapshot ? teachingReplayDetail(snapshot, sessionId, contactPage, pageSize) : await getTeachingRecords(sessionId, contactPage, pageSize);
    return Response.json(data, { headers: { ...headers, "Server-Timing": `records;dur=${(performance.now() - started).toFixed(1)}` } });
  } catch {
    return Response.json({ code: "UNAVAILABLE" }, { status: 503, headers });
  }
}
