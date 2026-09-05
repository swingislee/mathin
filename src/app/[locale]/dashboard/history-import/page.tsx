import { cache, Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { HistoryArchiveCommandBar, HistoryArchiveWorkbench } from "@/features/school/HistoryArchiveWorkbench";
import { isLocalHistoryArchiveEnvironment, parseHistoryArchiveFilters } from "@/features/school/history-archive-contract";
import { loadHistoryArchiveDetail, loadHistoryArchivePage } from "@/features/school/history-archive-data";
import { getHistoryArchiveMessages } from "@/features/school/history-archive-messages";
import { redirect } from "@/i18n/navigation";
import { getProfile, requireDashboardEnvironment } from "@/lib/auth";

export const metadata = { robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// 命令栏和正文在同一请求内复用鉴权后的读取，私有资料始终在管理员检查之后加载。
const loadAuthorizedArchive = cache(async (locale: string, searchParams: SearchParams) => {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { user } = await requireDashboardEnvironment(locale, ["staff"]);
  const profile = await getProfile(user.id);
  if (profile?.role !== "admin") redirect({ locale, href: "/dashboard" });

  const filters = parseHistoryArchiveFilters(await searchParams);
  const [data, detail] = await Promise.all([
    loadHistoryArchivePage(filters),
    filters.record ? loadHistoryArchiveDetail(filters.record, filters.relatedPage) : Promise.resolve(null),
  ]);
  return { filters, data, detail };
});

export default async function HistoryImportPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: SearchParams;
}) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const messages = getHistoryArchiveMessages(locale);

  return (
    <DashboardPage
      title={messages.title}
      description={messages.description}
      commandPanel={<Suspense fallback={<DashboardCommandPanel><Skeleton className="h-9 w-80 max-w-full" /></DashboardCommandPanel>}>
        <ArchiveCommandPanel locale={locale} searchParams={searchParams} />
      </Suspense>}
    >
      <Suspense fallback={<div role="status" className="space-y-4"><p className="text-sm text-muted">{messages.loading}</p><Skeleton className="h-12 w-full" /><Skeleton className="h-72 w-full" /></div>}>
        <ArchiveBody locale={locale} searchParams={searchParams} />
      </Suspense>
    </DashboardPage>
  );
}

async function ArchiveCommandPanel({ locale, searchParams }: { locale: string; searchParams: SearchParams }) {
  const { filters } = await loadAuthorizedArchive(locale, searchParams);
  return <HistoryArchiveCommandBar filters={filters} messages={getHistoryArchiveMessages(locale)} />;
}

async function ArchiveBody({ locale, searchParams }: { locale: string; searchParams: SearchParams }) {
  const { filters, data, detail } = await loadAuthorizedArchive(locale, searchParams);
  return <HistoryArchiveWorkbench filters={filters} data={data} detail={detail} messages={getHistoryArchiveMessages(locale)} />;
}
