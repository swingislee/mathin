import { Skeleton } from "@/components/ui/skeleton";

export default function CoursewarePreviewLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-busy="true">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-7 w-72" />
          <Skeleton className="mt-2 h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </div>
      <Skeleton className="mt-5 aspect-video w-full rounded-xl" />
      <div className="mt-5 flex justify-between">
        <Skeleton className="h-8 w-20 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}
