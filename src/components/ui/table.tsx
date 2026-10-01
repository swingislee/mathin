import * as React from "react";
import { cn } from "@/lib/utils";
import styles from "./table.module.css";

type TableProps = React.ComponentProps<"table"> & {
  containerClassName?: string;
  /** 窄屏将前两列作为摘要，其余字段纵向排列；沿用原行、详情和输入状态。 */
  mobileLayout?: "records";
};
export function Table({ className, containerClassName, mobileLayout, ...props }: TableProps) {
  return <div data-slot="table-container" data-table-mobile-layout={mobileLayout}
    className={cn("relative w-full overflow-x-auto", containerClassName, mobileLayout === "records" && styles.records)}>
    <table data-slot="table" className={cn("w-full bg-card caption-bottom text-sm", className)} {...props} />
  </div>;
}
export function TableHeader({ className,...props }:React.ComponentProps<"thead">){return <thead className={cn("border-b border-line",className)} {...props}/>;}
export function TableBody({ className,...props }:React.ComponentProps<"tbody">){return <tbody className={cn("divide-y divide-line",className)} {...props}/>;}
export function TableRow({ className,...props }:React.ComponentProps<"tr">){return <tr className={cn("bg-card transition-colors hover:bg-table-hover",className)} {...props}/>;}
export function TableHead({ className,...props }:React.ComponentProps<"th">){return <th className={cn("h-10 px-4 text-left align-middle text-xs font-medium text-muted",className)} {...props}/>;}
type TableCellProps = React.ComponentProps<"td"> & {
  mobileLabel?: string;
  mobileHidden?: boolean;
  mobileEmpty?: boolean;
  mobileSpan?: "full";
};
export function TableCell({ className, mobileLabel, mobileHidden, mobileEmpty, mobileSpan, children, ...props }: TableCellProps) {
  return <td data-slot="table-cell" data-table-mobile-hidden={mobileHidden || undefined}
    data-table-mobile-empty={mobileEmpty || undefined} data-table-mobile-span={mobileSpan}
    data-table-mobile-labeled={Boolean(mobileLabel) || undefined} className={cn("px-4 py-3 align-middle", className)} {...props}>
    {mobileLabel && <span data-table-mobile-label className={styles.label}>{mobileLabel}</span>}{children}
  </td>;
}
export function TableCaption({ className,...props }:React.ComponentProps<"caption">){return <caption className={cn("mt-4 text-sm text-muted",className)} {...props}/>;}
