import { Skeleton } from "@/components/ui/skeleton";

export default function OrganizationSettingsLoading() {
  return <div className="space-y-5 p-5 sm:p-7"><Skeleton className="h-9 w-64" /><Skeleton className="h-10 w-full max-w-xl" /><Skeleton className="h-80 w-full rounded-2xl" /></div>;
}
