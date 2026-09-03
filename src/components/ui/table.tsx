import * as React from "react";
import { cn } from "@/lib/utils";
type TableProps = React.ComponentProps<"table"> & { containerClassName?: string };
export function Table({ className, containerClassName, ...props }: TableProps) { return <div data-slot="table-container" className={cn("relative w-full overflow-x-auto",containerClassName)}><table data-slot="table" className={cn("w-full caption-bottom text-sm",className)} {...props}/></div>; }
export function TableHeader({ className,...props }:React.ComponentProps<"thead">){return <thead className={cn("border-b border-line",className)} {...props}/>;}
export function TableBody({ className,...props }:React.ComponentProps<"tbody">){return <tbody className={cn("divide-y divide-line",className)} {...props}/>;}
export function TableRow({ className,...props }:React.ComponentProps<"tr">){return <tr className={cn("transition-colors hover:bg-moon/15",className)} {...props}/>;}
export function TableHead({ className,...props }:React.ComponentProps<"th">){return <th className={cn("h-10 px-4 text-left align-middle text-xs font-medium text-muted",className)} {...props}/>;}
export function TableCell({ className,...props }:React.ComponentProps<"td">){return <td className={cn("px-4 py-3 align-middle",className)} {...props}/>;}
export function TableCaption({ className,...props }:React.ComponentProps<"caption">){return <caption className={cn("mt-4 text-sm text-muted",className)} {...props}/>;}
