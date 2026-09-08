import { getStudentStageSubjectAction } from "@/features/school/student-stage-actions";

/** 复用既有输入校验、身份和学生范围检查，仅改变详情读取的传输方式。 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  let input: Parameters<typeof getStudentStageSubjectAction>[0];
  try {
    input = await request.json();
  } catch {
    return Response.json({ ok: false, code: "VALIDATION" }, { status: 400, headers });
  }
  const result = await getStudentStageSubjectAction(input);
  return Response.json(result, { headers });
}
