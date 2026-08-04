import { Skeleton } from "@/components/ui/skeleton";

/*
 * 骨架的列数必须与真实页面同源（docs/plan/27 §5.3）。真实页面用 @container/page，
 * 骨架原先用 md:/lg: 视口断点，两者在 1024–1280 之间给出不同列数，加载完成的那一帧
 * 会看到卡片列数跳变。这里自建同名容器，判据与 DashboardContentGrid 对齐。
 */
export default function DashboardLoading() {
  return (
    <main className="@container/page w-full min-w-0 py-6" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <div className="mt-6 grid gap-4 @3xl/page:grid-cols-2 @6xl/page:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}
      </div>
    </main>
  );
}
