import { Skeleton } from "@/components/ui/skeleton";

export default function StudentDirectoryLoading() {
  return <div aria-busy="true" className="space-y-5 p-4 md:p-6">
    <Skeleton className="h-7 w-24" />
    <div className="flex flex-wrap gap-2">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-32" />)}</div>
    <Skeleton className="h-4 w-40" />
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2">
      {Array.from({ length: 24 }, (_, index) => <Skeleton key={index} className="h-24 rounded-lg" />)}
    </div>
  </div>;
}
