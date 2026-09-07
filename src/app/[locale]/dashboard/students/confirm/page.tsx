import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Skeleton } from '@/components/ui/skeleton';
import { isLocalHistoryArchiveEnvironment } from '@/features/school/history-archive-contract';
import { loadProfileReview } from '@/features/school/profile-review-data';
import { ProfileReviewWorkspace } from '@/features/school/ProfileReviewWorkspace';

export const metadata = { robots: { index: false, follow: false } };

export default async function ProfileReviewPage({ params }: { params: Promise<{ locale: string }> }) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  return <Suspense fallback={<div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-80 w-full" /></div>}>
    <AuthorizedReview locale={locale} />
  </Suspense>;
}

async function AuthorizedReview({ locale }: { locale: string }) {
  return <ProfileReviewWorkspace locale={locale} data={await loadProfileReview(locale)} />;
}
