import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import { getProfileReviewMessages } from './profile-review-messages';

/** 开发端按实际分配的读取权限显示入口。 */
export async function ProfileReviewLink({ locale }: { locale: string }) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) return null;
  const client = await createClient();
  const { data } = await client.from('student_profile_review_groups').select('id').limit(1);
  if (!data?.length) return null;
  return <Link href="/dashboard/students/confirm" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
    {getProfileReviewMessages(locale).title}
  </Link>;
}
