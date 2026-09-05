import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-52" /><Skeleton className="h-12 w-full" /><Skeleton className="h-[28rem] w-full" /></div>;
}
