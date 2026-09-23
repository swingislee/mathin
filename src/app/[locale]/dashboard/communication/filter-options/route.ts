import { getFirstContactFacetsAction } from "@/features/school/first-contact-facets-action";

/** 候选读取独立于页面导航和保存队列，复用列表的身份与范围检查。 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  let input: Parameters<typeof getFirstContactFacetsAction>[0];
  try { input = await request.json(); }
  catch { return Response.json({ ok: false, code: "VALIDATION" }, { status: 400, headers }); }
  return Response.json(await getFirstContactFacetsAction(input), { headers });
}
