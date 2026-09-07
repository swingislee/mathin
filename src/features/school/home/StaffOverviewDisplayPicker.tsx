"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRouter } from "@/i18n/navigation";
import { encodeOverviewDisplaySelection, saveOverviewDisplayCookies, type OverviewDisplayGroup } from "./staff-overview-display-contract";

export function StaffOverviewDisplayPicker({ groups, ariaLabel }: {
  groups: OverviewDisplayGroup[]; ariaLabel: string;
}) {
  const t = useTranslations("school.home.overview");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const initialSelection = () => Object.fromEntries(groups.map(group => [group.scope, new Set(group.selectedIds)]));
  const [selected, setSelected] = useState(initialSelection);
  const [activeScope, setActiveScope] = useState(groups[0]?.scope);
  const [pending, startTransition] = useTransition();
  const active = groups.find(group => group.scope === activeScope) ?? groups[0];
  if (!active) return null;
  const selectedIds = selected[active.scope] ?? new Set(active.selectedIds);
  const options = active.options.filter(person => person.name.toLowerCase().includes(query.trim().toLowerCase()));
  const changeSelection = (ids: Set<string>) => setSelected(previous => ({ ...previous, [active.scope]: ids }));
  const save = (reset = false) => {
    const saved = saveOverviewDisplayCookies(groups.map(group => ({
      name: group.cookieName,
      value: reset ? null : encodeOverviewDisplaySelection([...(selected[group.scope] ?? new Set(group.selectedIds))], group.options),
    })), document);
    if (!saved) { toast.error(t("displaySaveError")); return; }
    toast.success(t("displaySaved"));
    setOpen(false);
    startTransition(() => router.refresh());
  };
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) { setSelected(initialSelection()); setQuery(""); } }}>
    <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-7 gap-1.5 px-1.5 text-[10px]" disabled={pending} aria-label={ariaLabel} title={ariaLabel}>
      <SlidersHorizontal className="size-3.5" aria-hidden />{t("displaySettings")}
    </Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3">
      <p className="text-xs leading-5 text-muted">{t("displayNote")}</p>
      {groups.length > 1 ? <div className="flex gap-1" role="group" aria-label={ariaLabel}>
        {groups.map(group => <Button key={group.scope} size="sm" variant={active.scope === group.scope ? "secondary" : "ghost"}
          aria-pressed={active.scope === group.scope} className="h-8 px-3 text-xs"
          onClick={() => { setActiveScope(group.scope); setQuery(""); }}>{group.label}</Button>)}
      </div> : null}
      <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("displaySearch")} aria-label={t("displaySearch")} className="h-8" />
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span>{t("displaySelected", { count: selectedIds.size })}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => changeSelection(new Set([...selectedIds, ...options.map(option => option.userId)]))}>{t("displaySelectAll")}</Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={() => changeSelection(new Set([...selectedIds].filter(id => !options.some(option => option.userId === id))))}>{t("displayClear")}</Button>
        </div>
      </div>
      <div className="max-h-64 space-y-0.5 overflow-y-auto" role="group" aria-label={active.label}>
        {options.map(person => <label key={person.userId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-moon/20">
          <Checkbox checked={selectedIds.has(person.userId)} onCheckedChange={checked => {
            const next = new Set(selectedIds); if (checked === true) next.add(person.userId); else next.delete(person.userId); changeSelection(next);
          }} />{person.name}
        </label>)}
        {options.length === 0 ? <p className="py-4 text-center text-xs text-muted">{t("displayNoMatches")}</p> : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => save(true)}>{t("displayReset")}</Button>
        <Button size="sm" disabled={pending} onClick={() => save()}>{t("displaySave")}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
