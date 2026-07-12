import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
export function Breadcrumb({ className,...props }:React.ComponentProps<"nav">){return <nav aria-label="breadcrumb" className={cn("text-xs text-muted",className)} {...props}/>;}
export function BreadcrumbList({ className,...props }:React.ComponentProps<"ol">){return <ol className={cn("flex flex-wrap items-center gap-1.5",className)} {...props}/>;}
export function BreadcrumbItem({ className,...props }:React.ComponentProps<"li">){return <li className={cn("inline-flex items-center gap-1.5",className)} {...props}/>;}
export function BreadcrumbSeparator(){return <li aria-hidden="true"><ChevronRight size={12}/></li>;}
export function BreadcrumbPage({ className,...props }:React.ComponentProps<"span">){return <span aria-current="page" className={cn("text-ink",className)} {...props}/>;}
