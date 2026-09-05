import { getLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardCommandPanel, DashboardPage } from "@/features/school/dashboard-page";
import { getHistoryArchiveMessages } from "@/features/school/history-archive-messages";

export default async function HistoryImportLoading() {
  const messages = getHistoryArchiveMessages(await getLocale());
  return (
    <DashboardPage
      title={messages.title}
      description={messages.description}
      commandPanel={<DashboardCommandPanel><Skeleton className="h-9 w-80 max-w-full" /></DashboardCommandPanel>}
    >
      <div role="status" className="space-y-4">
        <p className="text-sm text-muted">{messages.loading}</p>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </DashboardPage>
  );
}
