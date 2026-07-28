import type { ComponentProps, ReactNode } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectTrigger } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * 不带任何外边距：筛选条现在住在 DashboardCommandPanel 的 filters 槽里，
 * 纵向节奏由面板统一给出（docs/plan/21 §19.2）。原来的默认 `mt-4` 是页面一级
 * 外边距散落在组件里的典型例子，会让每个调用方的上下间距各差一点。
 *
 * `relative`：FilterBarMore 的浮层以**筛选条本身**为定位参照，而不是那颗"更多筛选"
 * 按钮（doc 24 §3.2）。按钮在 390px 上通常已经贴到右边线，以它为参照的 `right-0`
 * 会把 358px 宽的面板整个推到视口左边界之外——左侧的 label 与第一列控件直接不可见。
 * 以筛选条为参照，面板最宽就是筛选条的宽度，永远落在画布内。
 */
const BAR_CLASS = "relative flex min-w-0 flex-1 flex-wrap items-center gap-2";

/**
 * Dashboard 列表的统一轻量筛选条。它只编排 shadcn 输入控件和 GET 表单，
 * 不拥有任何领域查询状态，因此服务端列表和客户端 URL 筛选都能复用。
 */
export function FilterBar({ className, children, ...props }: ComponentProps<"form">) {
  return <form role="search" className={cn(BAR_CLASS, className)} {...props}>{children}</form>;
}

/** 用于 Select 变化后立即改 URL 等无需提交表单的筛选。 */
export function FilterBarFrame({ className, children, ...props }: ComponentProps<"div">) {
  return <div role="search" className={cn(BAR_CLASS, className)} {...props}>{children}</div>;
}

export function FilterSearchInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <div className="relative min-w-0 grow basis-40 sm:max-w-sm">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input
        className={cn("h-9 rounded-full border-line/80 bg-card/70 pl-9 shadow-none focus-visible:bg-card", className)}
        {...props}
      />
    </div>
  );
}

export function FilterSelectTrigger({ className, ...props }: ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger className={cn("h-9 w-auto min-w-32 rounded-full bg-card/70 shadow-none", className)} {...props} />;
}

/**
 * 提交筛选走 moon 底色（设计系统 §1「月亮黄：主强调底色」），不再和"更多筛选/重置"
 * 一样是 crater 描边：一行里有三四个同款描边按钮时，用户看不出哪个才是真正触发查询的。
 * 同时不能用 rose——那是全页唯一的主行动色（新建学生一类），筛选抢不得。
 */
export function FilterBarSubmit({ children, className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="submit"
      variant="secondary"
      size="sm"
      className={cn("h-9 border-moon bg-moon/40 text-ink hover:bg-moon/70", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export function FilterBarReset({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-9 px-3", className)}>
      <RotateCcw className="size-3.5" />
      {label}
    </Link>
  );
}

/**
 * 高级条件留在 form DOM 子树内，确保 Radix Select 的隐藏字段能随 GET 表单提交；
 * 面板绝对定位，不会把列表向下顶开。
 *
 * 多于一个 Select 的页面一律走这里而不是平铺（docs/plan/21 §14.5）：命令面板在
 * 窄容器下只有两行预算，平铺四五个 Select 会把 sticky 顶部撑到小半个视口。
 * `activeCount` 把"当前有几个条件生效"显式说出来，否则条件收起来之后用户无从判断
 * 列表为什么是空的。
 */
export function FilterBarMore({
  label,
  children,
  activeCount = 0,
  className,
}: {
  label: string;
  children: ReactNode;
  activeCount?: number;
  className?: string;
}) {
  return (
    // 不带 relative：定位参照是外层 FilterBar（见 BAR_CLASS）。
    <details className="shrink-0">
      <summary className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9 cursor-pointer list-none px-3")}>
        <SlidersHorizontal className="size-3.5" />
        {label}
        {activeCount > 0 ? <span className="ml-1 rounded-full bg-crater/15 px-1.5 text-xs tabular-nums text-ink">{activeCount}</span> : null}
      </summary>
      {/*
        两层：外层只负责"横跨筛选条、贴着它的下沿"，内层才是面板本体并靠右。
        宽度写成 `min(32rem,100%)` 而不是 `min(32rem,100vw-2rem)`——后者量的是视口，
        面板却锚在筛选条上，两个坐标系不一致正是它会跑出左边界的原因。
      */}
      <div className="absolute inset-x-0 top-full z-30 mt-2 flex justify-end">
        <div className={cn("w-[min(32rem,100%)] rounded-2xl border border-line bg-card p-4 text-ink shadow-sm", className)}>
          {children}
        </div>
      </div>
    </details>
  );
}
