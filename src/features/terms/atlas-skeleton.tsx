import { Skeleton } from "@/components/ui/skeleton";

/** 图鉴首页 / 图谱页的加载骨架（3D 场景与图谱首屏都较重）。
 *  只挂在这两条静态路由上——挂在 /terms 顶层会给整棵子树套上流式边界，
 *  外壳一旦发出，动态段的 404 就只能是 soft 404（200 + noindex）。 */
export function AtlasSkeleton() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-8 h-[55vh] rounded-3xl" />
    </main>
  );
}
