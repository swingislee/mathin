import { Skeleton } from "@/components/ui/skeleton";

export default function CoursewareLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 space-y-2">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
