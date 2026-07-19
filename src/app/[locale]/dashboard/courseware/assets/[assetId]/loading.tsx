import { Skeleton } from "@/components/ui/skeleton";

export default function CoursewareAssetDetailLoading() {
  return <div className="mx-auto w-full max-w-7xl space-y-4"><Skeleton className="h-12 w-64" /><Skeleton className="h-[36rem] w-full rounded-2xl" /></div>;
}
