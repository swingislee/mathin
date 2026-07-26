import type { ComponentProps, ReactNode } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectTrigger } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const BAR_CLASS = "mt-4 flex min-h-12 flex-wrap items-center gap-2 py-1";

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
    <div className="relative min-w-48 flex-1 sm:max-w-sm">
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

export function FilterBarSubmit({ children, className, ...props }: ComponentProps<typeof Button>) {
  return <Button type="submit" variant="secondary" size="sm" className={cn("h-9", className)} {...props}>{children}</Button>;
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
 */
export function FilterBarMore({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <details className="relative">
      <summary className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9 cursor-pointer list-none px-3")}>
        <SlidersHorizontal className="size-3.5" />
        {label}
      </summary>
      <div className={cn("absolute right-0 top-full z-30 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-4 text-ink shadow-sm", className)}>
        {children}
      </div>
    </details>
  );
}
