import { ZodError } from "zod";
import { readOverviewDetail } from "@/features/school/home/staff-overview-drilldown-actions";

/** 明细沿用 Action 的身份、环境与 RLS 检查，通过独立请求返回数据。 */
export async function POST(request: Request) {
  const started = performance.now();
  const headers = { "Cache-Control": "private, no-store" };
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ code: "VALIDATION" }, { status: 400, headers });
  }
  try {
    const result = await readOverviewDetail(input);
    return Response.json(result, { headers: {
      ...headers, "Server-Timing": `detail;dur=${(performance.now() - started).toFixed(1)}`,
    } });
  } catch (error) {
    const invalid = error instanceof ZodError;
    const forbidden = error instanceof Error && error.message === "Overview access required";
    return Response.json({ code: invalid ? "VALIDATION" : forbidden ? "FORBIDDEN" : "UNAVAILABLE" }, {
      status: invalid ? 400 : forbidden ? 403 : 503, headers,
    });
  }
}
