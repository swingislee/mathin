import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function SessionLoading() {
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-5 py-6" aria-busy="true">
      <p role="status" className="text-sm text-muted">{t("loadingPage")}</p>
      <Skeleton className="h-8 w-64 max-w-full" />
      <div className="flex gap-3">
        {[0, 1, 2].map((key) => <Skeleton key={key} className="h-9 w-20 rounded-full" />)}
      </div>
      <Skeleton className="min-h-64 flex-1 rounded-2xl" />
    </div>
  );
}
