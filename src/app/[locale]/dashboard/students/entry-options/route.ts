import { getStudentStageOptionsAction } from "@/features/school/student-stage-actions";

/** 行内业务选项复用原授权读取，通过独立请求与列表渲染分离。 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  let input: Parameters<typeof getStudentStageOptionsAction>[0];
  try {
    input = await request.json();
  } catch {
    return Response.json({ ok: false, code: "VALIDATION" }, { status: 400, headers });
  }
  const result = await getStudentStageOptionsAction(input);
  return Response.json(result, { headers });
}
