import { Skeleton } from "@/components/ui/skeleton";

export default function RegistrationInviteLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-busy="true">
      <div className="border-b border-line pb-4">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      </div>
      <div className="mt-6 max-w-2xl rounded-2xl border border-line bg-card p-6">
        <div className="flex gap-4">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-11 w-full max-w-sm rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-8 h-16 w-full" />
      </div>
    </div>
  );
}
