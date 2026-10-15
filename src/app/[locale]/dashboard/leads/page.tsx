import SourceWorklistPage from '@/features/school/source-worklist/Page';

// 30 秒内回到本页直接复用浏览器里的名单；本机保存过数据时由 DashboardRevisitFreshness 在后台重新读取。
export const unstable_dynamicStaleTime = 30;

export default function LeadsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string,string | string[] | undefined>>;
}) {
  return <SourceWorklistPage {...props} firstContact />;
}
