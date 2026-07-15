import { Skeleton } from "@/components/ui/skeleton";

/**
 * 后台列表/报表子页的通用加载骨架（P4G-7 §6.4）。
 *
 * 这些页面（students / finance / followups / schedule / operations / classes /
 * courses …）的顶层形状统一：`mx-auto max-w-6xl` 容器 + `SchoolPageHeader`
 * （h1 + 副标题 + 右侧动作）+ 一条筛选条 + 一张表。在此之前它们继承的是
 * dashboard 首页那份「磁贴网格」骨架，从磁贴闪成表格观感割裂——这里给出形状
 * 对得上的表格骨架，各子路由用一行 `loading.tsx` re-export 复用（同 terms
 * `(atlas)/loading.tsx` 复用 AtlasSkeleton 的写法）。
 */
export function DashboardListSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl" aria-busy="true">
      {/* 页头：标题 + 副标题 + 右侧动作，底部一条分隔线 */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </header>

      {/* 筛选条 */}
      <div className="mt-6 flex flex-wrap gap-2">
        <Skeleton className="h-9 w-48 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* 表格：表头 + 8 行 */}
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        <Skeleton className="h-11 w-full rounded-none" />
        <div className="divide-y divide-line">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
