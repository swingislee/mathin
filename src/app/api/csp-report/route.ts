import { NextResponse } from "next/server";

/** CSP Report-Only 的违规收集端点（docs/plan/15-§7.1）。
 *
 *  刻意**不写数据库**：这是一个匿名可 POST 的端点，落 `operational_errors` 等于给
 *  任何人一把灌满审计表的勺子。违规只走结构化 stdout（与 instrumentation.ts 同一
 *  条日志通道，运维手册已在采集），观察期结束、白名单收敛后即可切强制 CSP。 */

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const raw = (await request.text()).slice(0, MAX_BODY_BYTES);
  let report: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const nested = parsed["csp-report"];
    report = (nested && typeof nested === "object" ? (nested as Record<string, unknown>) : parsed) ?? {};
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const pick = (key: string): string | undefined => {
    const value = report[key];
    return typeof value === "string" ? value.slice(0, 300) : undefined;
  };

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "security.csp_violation",
      at: new Date().toISOString(),
      directive: pick("effective-directive") ?? pick("violated-directive"),
      blockedUri: pick("blocked-uri"),
      documentUri: pick("document-uri"),
      sourceFile: pick("source-file"),
      lineNumber: typeof report["line-number"] === "number" ? report["line-number"] : undefined,
      environment: process.env.NODE_ENV,
      release: process.env.MATHIN_RELEASE?.slice(0, 100),
    }),
  );

  return new NextResponse(null, { status: 204 });
}
