import { Skeleton } from "@/components/ui/skeleton";

export default function MonthlyTargetsLoading() {
  return <div className="space-y-6 py-6" aria-busy="true">
    <Skeleton className="h-8 w-60" />
    <Skeleton className="h-12 w-full" />
    <div className="grid grid-cols-3 gap-6">{[0, 1, 2].map(value => <Skeleton key={value} className="h-20" />)}</div>
    <Skeleton className="h-96 w-full" />
  </div>;
}
