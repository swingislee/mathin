"use client";

import { useRef, useState, type ComponentProps } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DashboardSearch({ className, value, defaultValue, onChange, name, onSearch, ...props }: ComponentProps<typeof Input> & { onSearch?: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ initial: defaultValue, value: defaultValue ?? "" });
  const hidden = useRef<HTMLInputElement>(null);
  const current = value ?? (draft.initial === defaultValue ? draft.value : defaultValue ?? "");
  const label = props["aria-label"] ?? props.placeholder ?? "Search";
  const apply = () => { onSearch?.(); if (name) hidden.current?.form?.requestSubmit(); setOpen(false); };
  return <span data-dashboard-search className="inline-flex shrink-0">
    <Input ref={hidden} type="hidden" name={name} value={current} />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label={label} title={String(label)} className={cn("relative size-9 rounded-full p-0", current && "bg-blue/10 text-blue")}>
        <Search className="size-4" aria-hidden />{current ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-blue" /> : null}
      </Button></PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-3">
        <div className="flex items-center gap-2"><Input {...props} type="search" value={current} className={cn("h-9 min-w-0", className)}
          onChange={(event) => { setDraft({ initial: defaultValue, value: event.target.value }); onChange?.(event); }}
          onKeyDown={(event) => { props.onKeyDown?.(event); if (event.key === "Enter" && !event.defaultPrevented) { event.preventDefault(); apply(); } }} />
          <Button type="button" size="sm" variant="secondary" aria-label={label} onClick={apply} className="size-9 shrink-0 p-0"><Search className="size-4" aria-hidden /></Button>
        </div>
      </PopoverContent>
    </Popover>
  </span>;
}
