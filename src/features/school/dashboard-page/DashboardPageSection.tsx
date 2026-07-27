import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 正文里的一级区块。纵向间距由 DashboardPageBody 的 density 统一给出，
 * 区块自己不带 mt-*——页面一级外边距分散在调用方是横向跳动之外的另一半乱源。
 */
export function DashboardPageSection({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("min-w-0", className)} {...props} />;
}
