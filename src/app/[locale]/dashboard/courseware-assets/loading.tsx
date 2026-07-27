import { Skeleton } from "@/components/ui/skeleton";

export default function SharedAssetLibraryLoading() {
  return <div className="w-full min-w-0 space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-[28rem] w-full rounded-2xl" /></div>;
}
