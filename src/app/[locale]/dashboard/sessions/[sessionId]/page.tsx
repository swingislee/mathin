import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSessionWorkspaceDetail } from "@/features/school/classes";
import { parseReturnTo } from "@/features/school/object-workspace";
import { parseSessionStage, SessionWorkspaceBody } from "@/features/school/SessionWorkspaceBody";
import { requireDashboardEnvironment } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * canonical 课次工作区：课前/课堂/课后三段结构 + 完成备课冻结编排。
 *
 * doc 23 §10：`?tab=` 已硬切成 `?stage=`，不保留兼容——项目尚未首次部署，
 * 留一层 alias 只会让"这三段是流程不是页签"这个结论在 URL 上继续说反话。
 */
export default async function SessionWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
  searchParams: Promise<{
    stage?: string;
    returnTo?: string | string[];
    focus?: string | string[];
    prepStep?: string | string[];
    prepPage?: string | string[];
  }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="flex w-full min-w-0 flex-1 flex-col xl:h-full xl:min-h-0">
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-2xl border border-line bg-card" />}>
        <SessionWorkspaceContent locale={locale} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SessionWorkspaceContent({
  locale,
  params,
  searchParams,
}: {
  locale: string;
  params: Promise<{ locale: string; sessionId: string }>;
  searchParams: Promise<{
    stage?: string;
    returnTo?: string | string[];
    focus?: string | string[];
    prepStep?: string | string[];
    prepPage?: string | string[];
  }>;
}) {
  const { environment } = await requireDashboardEnvironment(locale, ["staff"]);
  const [{ sessionId }, rawSearchParams] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(sessionId)) notFound();

  const detail = await getSessionWorkspaceDetail(sessionId);
  if (!detail) notFound();

  // §18：课次从班级详情、课表、今日工作三处进入，返回必须回到来的地方；
  // returnTo 是用户可改的输入，所以过合同校验后才使用，无效时回 canonical 父页面。
  const returnTo = parseReturnTo({ returnTo: rawSearchParams.returnTo, environment });

  return (
    <SessionWorkspaceBody
      detail={detail}
      stage={parseSessionStage(rawSearchParams.stage, detail.state)}
      backHref={returnTo ?? `/dashboard/classes/${detail.classroomId}`}
      returnTo={returnTo}
      focusTarget={typeof rawSearchParams.focus === "string" ? rawSearchParams.focus.slice(0, 160) : undefined}
      initialPrepStep={rawSearchParams.prepStep === "design" || rawSearchParams.prepStep === "rehearsal"
        ? rawSearchParams.prepStep : rawSearchParams.prepStep === "study" ? "study" : undefined}
      initialPrepPageId={typeof rawSearchParams.prepPage === "string" && UUID_PATTERN.test(rawSearchParams.prepPage)
        ? rawSearchParams.prepPage : undefined}
    />
  );
}
