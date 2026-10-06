import { redirect } from '@/i18n/navigation';
import { workEntryHref } from '@/features/school/work-entry-contract';

export default async function CommunicationRedirect({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string,string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params,searchParams]);
  redirect({ href: workEntryHref('/dashboard/communication',query), locale });
}
