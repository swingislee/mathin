import { Skeleton } from "@/components/ui/skeleton";

export default function SharedAssetDetailLoading() {
  return <div className="w-full min-w-0 space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-[36rem] w-full rounded-2xl" /></div>;
}
