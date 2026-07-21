import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getSessionWorkspaceDetail } from "@/features/school/classes";
import { SessionWorkspaceBody, type SessionTab } from "@/features/school/SessionWorkspaceBody";
import { requireUser } from "@/lib/auth";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P4I-14 canonical 课次工作区：课前/课堂/课后三段结构 + 完成备课冻结编排。
 * doc19 §14 的备课复制/更新 release/空白课堂降级/主动作算法均已接线；
 * 课后逐任务专用表单（点名网格/课评撰写/视频审阅）留给 P4I-15。
 */
export default async function SessionWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; sessionId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col xl:h-full xl:min-h-0">
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
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser(locale);
  const [{ sessionId }, rawSearchParams] = await Promise.all([params, searchParams]);
  if (!UUID_PATTERN.test(sessionId)) notFound();

  const detail = await getSessionWorkspaceDetail(sessionId);
  if (!detail) notFound();

  const activeTab: SessionTab = rawSearchParams.tab === "live" ? "live" : rawSearchParams.tab === "post" ? "post" : "pre";

  return <SessionWorkspaceBody detail={detail} activeTab={activeTab} />;
}
