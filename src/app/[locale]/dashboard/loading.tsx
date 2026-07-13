import { Skeleton } from "@/components/ui/skeleton";
export default function DashboardLoading(){return <main className="mx-auto w-full max-w-6xl p-6" aria-busy="true"><Skeleton className="h-8 w-48"/><div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{Array.from({length:6},(_,index)=><Skeleton key={index} className="h-40 rounded-2xl"/>)}</div></main>}
