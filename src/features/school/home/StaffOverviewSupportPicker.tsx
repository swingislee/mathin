"use client";

import { useState, useTransition } from "react";
import { UsersRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRouter } from "@/i18n/navigation";
import type { OverviewStaffOption } from "./staff-overview-display-contract";

export function StaffOverviewSupportPicker({ options, selectedIds, cookieName }: {
  options: OverviewStaffOption[]; selectedIds: string[]; cookieName: string;
}) {
  const t = useTranslations("school.home.overview");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set(selectedIds));
  const [pending, startTransition] = useTransition();
  const save = (reset = false) => {
    document.cookie = `${cookieName}=${reset ? "" : [...selected].join(",") || "none"}; Path=/; Max-Age=${reset ? 0 : 31536000}; SameSite=Lax`;
    setOpen(false);
    startTransition(() => router.refresh());
  };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) { setSelected(new Set(selectedIds)); setQuery(""); } }}>
    <PopoverTrigger asChild><Button size="sm" variant="secondary" className="h-8 gap-1.5 px-2 text-xs" disabled={pending}>
      <UsersRound className="size-3.5" aria-hidden />{t("supportDisplay", { count: selectedIds.length })}
    </Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3">
      <p className="text-xs leading-5 text-muted">{t("supportDisplayNote")}</p>
      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("supportSearch")} aria-label={t("supportSearch")} className="h-8" />
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {options.filter(person => person.name.toLowerCase().includes(query.trim().toLowerCase())).map(person => <label key={person.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-moon/20">
          <Checkbox checked={selected.has(person.userId)} onCheckedChange={checked => setSelected(previous => {
            const next = new Set(previous); if (checked === true) next.add(person.userId); else next.delete(person.userId); return next;
          })} />{person.name}
        </label>)}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <Button size="sm" variant="ghost" onClick={() => save(true)}>{t("supportReset")}</Button>
        <Button size="sm" onClick={() => save()}>{t("supportApply", { count: selected.size })}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
