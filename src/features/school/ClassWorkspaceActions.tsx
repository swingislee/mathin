"use client";

import { useLocale } from "next-intl";
import { Ellipsis } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from "@/i18n/navigation";
import { classWorkHref, workEntryMessages, type ClassWorkView, type WorkEntryQuery } from "./work-entry-contract";

/** 班级名册保持主画面，跨班记录与管理从辅助操作进入。 */
export function ClassWorkspaceActions({ canTeach, query }: { canTeach: boolean; query: WorkEntryQuery }) {
  const m = workEntryMessages(useLocale());
  if (!canTeach) return <Link href={classWorkHref("directory", query)} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m.directory}</Link>;
  const views: ClassWorkView[] = ["records", "progress", "directory"];
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm"><Ellipsis className="size-3.5" aria-hidden />{m.classActions}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-44 p-1"><nav aria-label={m.classActions} className="flex flex-col">
      {views.map(view => <Link key={view} href={classWorkHref(view, query)} className={buttonVariants({ variant: "ghost", size: "sm", className: "justify-start" })}>{m[view]}</Link>)}
    </nav></PopoverContent>
  </Popover>;
}
