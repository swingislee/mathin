import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页面内部的 12 列容器网格（docs/plan/21 §16）。
 *
 * 取消页面根级限宽后，"内容多宽"从页面外层下沉到这里：表格铺满，表单走 8+4，
 * 长文本自己收窄。断点一律用 page 容器查询，因为固定侧栏下浏览器宽度并不等于
 * 页面可用宽度。
 */
export function DashboardContentGrid({ children, className }: { children: ReactNode; className?: string }) {
  // items-start：默认的 stretch 会把主列拉到与侧栏等高，一张只有一行订单的卡片
  // 被抻成一整屏空白框，反而比迁移前更空。
  return <div className={cn("grid min-w-0 grid-cols-12 items-start gap-4 @4xl/page:gap-6", className)}>{children}</div>;
}

/** 主列：窄容器整宽，宽容器 8 列。 */
export function DashboardMainColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("col-span-12 min-w-0 @4xl/page:col-span-8", className)}>{children}</div>;
}

/**
 * 侧栏：窄容器整宽落到主列下方，宽容器 4 列。
 *
 * 默认就是"一摞卡片"（doc 23 §5.2）：每个重建后的对象页都在调用点写同一个
 * `flex flex-col gap-4`，那是纵向节奏该由容器给的信号。需要别的排布仍可用
 * className 覆盖。
 */
export function DashboardAside({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside className={cn("col-span-12 flex min-w-0 flex-col gap-4 @4xl/page:col-span-4", className)}>{children}</aside>
  );
}

/** 阅读列：只限制文字块本身的行宽，不限制页面（§16.4）。 */
export function DashboardReadingColumn({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("max-w-[72ch] min-w-0", className)}>{children}</div>;
}

/** 卡片网格：页面变宽就增加列数，而不是靠收窄页面维持固定两列（§17.2）。 */
export function DashboardCardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-1 gap-4 @3xl/page:grid-cols-2 @6xl/page:grid-cols-3", className)}>
      {children}
    </div>
  );
}
