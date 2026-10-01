import * as React from "react";
import { cn } from "@/lib/utils";
import styles from "./table.module.css";

type TableProps = React.ComponentProps<"table"> & {
  containerClassName?: string;
  /** records 沿用嵌套记录外观；stacked 只在窄屏重排连续表格，桌面保持原样。 */
  mobileLayout?: "records" | "stacked";
};
export function Table({ className, containerClassName, mobileLayout, ...props }: TableProps) {
  return <div data-slot="table-container" data-table-mobile-layout={mobileLayout}
    className={cn("relative w-full overflow-x-auto", containerClassName, mobileLayout === "records" && styles.records, mobileLayout === "stacked" && styles.stacked)}>
    <table data-slot="table" className={cn("w-full bg-card caption-bottom text-sm", className)} {...props} />
  </div>;
}
export function TableHeader({ className,...props }:React.ComponentProps<"thead">){return <thead className={cn("border-b border-line",className)} {...props}/>;}
export function TableBody({ className,...props }:React.ComponentProps<"tbody">){return <tbody className={cn("divide-y divide-line",className)} {...props}/>;}
export function TableRow({ className,...props }:React.ComponentProps<"tr">){return <tr className={cn("bg-card transition-colors hover:bg-table-hover",className)} {...props}/>;}
export function TableHead({ className,...props }:React.ComponentProps<"th">){return <th className={cn("h-10 px-4 text-left align-middle text-xs font-medium text-muted",className)} {...props}/>;}
type TableCellProps = React.ComponentProps<"td"> & {
  /** 贴边内容使用零内边距，行轮廓保持在内容表面上方。 */
  flush?: boolean;
  mobileLabel?: string;
  mobileHidden?: boolean;
  mobileEmpty?: boolean;
  /** primary/secondary 组成手机摘要行，其余字段按原顺序排列。 */
  mobileSpan?: "full" | "primary" | "secondary";
};
export function TableCell({ className, flush = false, mobileLabel, mobileHidden, mobileEmpty, mobileSpan, children, ...props }: TableCellProps) {
  return <td data-slot="table-cell" data-table-mobile-hidden={mobileHidden || undefined}
    data-table-mobile-empty={mobileEmpty || undefined} data-table-mobile-span={mobileSpan}
    data-table-mobile-labeled={Boolean(mobileLabel) || undefined} className={cn("px-4 py-3 align-middle", flush && "relative p-0", flush && styles.flush, className)} {...props}>
    {mobileLabel ? <><span data-table-mobile-label className={styles.label}>{mobileLabel}</span><div data-table-mobile-value className={styles.value}>{children}</div></> : children}
  </td>;
}
export function TableCaption({ className,...props }:React.ComponentProps<"caption">){return <caption className={cn("mt-4 text-sm text-muted",className)} {...props}/>;}
