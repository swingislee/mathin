import { Skeleton } from "@/components/ui/skeleton";

/**
 * 后台列表/报表子页的通用加载骨架（P4G-7 §6.4，形状按 docs/plan/21 更新）。
 *
 * 这些页面（students / finance / followups / classes / courses …）现在共用
 * `DashboardPage`：出血到 canvas 两侧的 sticky chrome（页头 + 命令面板）+ 正文。
 * 骨架必须跟着这个形状走，否则加载态落地时会横向跳一下——正是这轮重构要消灭的
 * 东西。各子路由用一行 `loading.tsx` re-export 复用（同 terms `(atlas)/loading.tsx`
 * 复用 AtlasSkeleton 的写法）。
 */
export function DashboardListSkeleton() {
  return (
    <div className="w-full min-w-0" aria-busy="true">
      <div className="sticky top-0 z-30 mx-[calc(var(--dashboard-gutter,0px)*-1)] border-b border-line bg-paper/95 px-[var(--dashboard-gutter,0px)] backdrop-blur-md">
        <div className="flex min-h-16 items-center py-2.5 lg:min-h-[76px]">
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="flex min-h-14 items-center gap-3 border-t border-line/60 py-2">
          <Skeleton className="h-9 w-32 rounded-lg" />
          <Skeleton className="h-9 w-48 rounded-full" />
          <Skeleton className="ml-auto h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* 表格：表头 + 8 行 */}
      <div className="mt-5 overflow-hidden rounded-xl border border-line">
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
