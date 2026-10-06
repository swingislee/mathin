import SourceWorklistPage from '@/features/school/source-worklist/Page';

export default function LeadsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string,string | string[] | undefined>>;
}) {
  return <SourceWorklistPage {...props} firstContact />;
}
