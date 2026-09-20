"use client";

import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { classRosterTermOptions, type ClassRosterTerm } from "./class-roster-header-contract";
import { workEntryMessages } from "./work-entry-contract";

/** 名册以学期组织；沿用教学记录的本期、上期、日期范围与前后切换布局。 */
export function ClassRosterTermPicker({ terms, selectedId, onChange, disabled = false }: {
  terms: ClassRosterTerm[]; selectedId?: string; onChange: (id?: string) => void; disabled?: boolean;
}) {
  const t = useTranslations("school.teachingWorkbench.time");
  const m = workEntryMessages(useLocale());
  const [open, setOpen] = useState(false);
  const options = classRosterTermOptions(terms);
  const current = options.findIndex(term => term.isCurrent);
  const selected = options.findIndex(term => term.id === selectedId);
  const term = options[selected];
  const label = term ? `${term.name}${term.startsOn && term.endsOn ? ` · ${term.startsOn} — ${term.endsOn}` : ""}` : m.allTerms;
  const choose = (id?: string) => { onChange(id); setOpen(false); };
  return <div className="flex flex-wrap items-center gap-1" data-class-roster-period>
    {([current, current - 1] as const).map((index, position) => <Button key={position} disabled={disabled || index < 0} size="sm"
      variant={selectedId && selected === index ? "secondary" : "ghost"} className="h-8 px-2 text-xs"
      aria-pressed={Boolean(selectedId && selected === index)} onClick={() => choose(options[index]?.id)}>{t(position ? "previous_term" : "current_term")}</Button>)}
    <Button disabled={disabled || selected <= 0} variant="ghost" size="sm" className="size-8 p-0" aria-label={t("earlier_term")} onClick={() => choose(options[selected - 1]?.id)}><ChevronLeft className="size-4" /></Button>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button disabled={disabled} variant="secondary" size="sm" className="h-8 gap-1.5 px-2 text-xs tabular-nums" aria-label={`${t("choose")}：${label}`}><CalendarDays className="size-3.5" aria-hidden />{label}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-3"><div className="flex max-h-64 min-w-64 flex-col gap-1 overflow-auto">
        <Button variant={!selectedId ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => choose()}>{m.allTerms}</Button>
        {options.map(option => <Button key={option.id} variant={option.id === selectedId ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => choose(option.id)}>{option.name}</Button>)}
      </div></PopoverContent>
    </Popover>
    <Button disabled={disabled || selected < 0 || selected >= options.length - 1} variant="ghost" size="sm" className="size-8 p-0" aria-label={t("later_term")} onClick={() => choose(options[selected + 1]?.id)}><ChevronRight className="size-4" /></Button>
  </div>;
}
