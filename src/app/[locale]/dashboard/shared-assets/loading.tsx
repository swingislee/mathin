import { Skeleton } from "@/components/ui/skeleton";

export default function SharedAssetLibraryLoading() {
  return <div className="mx-auto w-full max-w-6xl space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-[28rem] w-full rounded-2xl" /></div>;
}
