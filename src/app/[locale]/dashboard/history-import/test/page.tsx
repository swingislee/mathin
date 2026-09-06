import { cache, Suspense } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardCommandPanel, DashboardPage } from '@/features/school/dashboard-page';
import { ImportedHistoryTrialCommands, ImportedHistoryTrialWorkbench } from '@/features/school/ImportedHistoryTrialWorkbench';
import { isLocalHistoryArchiveEnvironment } from '@/features/school/history-archive-contract';
import { loadImportedHistoryTrial } from '@/features/school/history-import-trial-data';
import { getHistoryImportTrialMessages } from '@/features/school/history-import-trial-messages';
import { redirect } from '@/i18n/navigation';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';

export const metadata = { robots: { index: false, follow: false } };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const load = cache(async (locale: string, searchParams: SearchParams) => {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  if ((await getProfile(user.id))?.role !== 'admin') redirect({ locale, href: '/dashboard' });
  const raw = await searchParams;
  return {
    q: typeof raw.q === 'string' ? raw.q.trim().slice(0, 200) : '',
    selectedCase: typeof raw.case === 'string' ? raw.case.slice(0, 160) : '',
    data: await loadImportedHistoryTrial(locale),
  };
});

export default async function HistoryImportTestPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: SearchParams }) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const m = getHistoryImportTrialMessages(locale);
  return <DashboardPage title={m.title} description={m.description}
    commandPanel={<Suspense fallback={<DashboardCommandPanel><Skeleton className="h-9 w-80 max-w-full" /></DashboardCommandPanel>}><Commands locale={locale} searchParams={searchParams} /></Suspense>}>
    <Suspense fallback={<div role="status"><p className="text-sm text-muted">{m.loading}</p><Skeleton className="mt-4 h-72 w-full" /></div>}>
      <Body locale={locale} searchParams={searchParams} />
    </Suspense>
  </DashboardPage>;
}

async function Commands({ locale, searchParams }: { locale: string; searchParams: SearchParams }) {
  const { q } = await load(locale, searchParams);
  return <ImportedHistoryTrialCommands locale={locale} q={q} messages={getHistoryImportTrialMessages(locale)} />;
}
async function Body({ locale, searchParams }: { locale: string; searchParams: SearchParams }) {
  return <ImportedHistoryTrialWorkbench {...await load(locale, searchParams)} messages={getHistoryImportTrialMessages(locale)} />;
}
