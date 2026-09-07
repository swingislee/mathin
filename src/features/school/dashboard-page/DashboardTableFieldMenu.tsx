"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Check, ListFilter, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { dashboardFieldMessages } from "./dashboard-field-messages";
import {
  DASHBOARD_DATE_GRAINS, dashboardDateBucket, dashboardDateBucketLabel, validDashboardDateRange,
  type DashboardDateContext, type DashboardDateGrain,
} from "./dashboard-table-date-contract";
import type { DashboardFieldFilter, DashboardFieldOption } from "./dashboard-table-field-contract";

export interface DashboardFieldControl {
  id: string;
  label: string;
  kind: "text" | "enum" | "date" | "number";
  hint?: string;
  disabled?: boolean;
  sortable: boolean;
  multiple?: boolean;
  step?: number;
  filter?: DashboardFieldFilter;
  sortDirection?: "asc" | "desc";
  options: DashboardFieldOption[];
  days: string[];
  onFilterChange: (filter: DashboardFieldFilter | undefined) => void;
  onSortChange: (direction: "asc" | "desc" | undefined) => void;
}
export interface DashboardTableFieldHeaderProps {
  label: string;
  fields: DashboardFieldControl[];
  context: DashboardDateContext;
  onClearColumn: () => void;
  onClearAll: () => void;
}

function PresenceControl({ field, locale }: { field: DashboardFieldControl; locale: string }) {
  const m = dashboardFieldMessages(locale);
  return <ToggleGroup type="single" value={field.filter?.kind === "presence" ? field.filter.value : field.filter ? "" : "all"}
    aria-label={`${field.label} · ${m.menu}`} className="justify-start gap-0.5" disabled={field.disabled}
    onValueChange={value => field.onFilterChange(value === "present" || value === "missing" ? { kind: "presence", value } : undefined)}>
    {(["all", "present", "missing"] as const).map(value => <ToggleGroupItem key={value} value={value}
      className="h-7 min-w-0 px-2 text-[11px]">{m[value]}</ToggleGroupItem>)}
  </ToggleGroup>;
}

function NumberRange({ field, locale }: { field: DashboardFieldControl; locale: string }) {
  const m = dashboardFieldMessages(locale), id = useId();
  const initial = field.filter?.kind === "number" ? field.filter : null;
  const [min, setMin] = useState(initial?.min?.toString() ?? "");
  const [max, setMax] = useState(initial?.max?.toString() ?? "");
  const low = min === "" ? undefined : Number(min), high = max === "" ? undefined : Number(max);
  const valid = (low !== undefined || high !== undefined) && (low === undefined || Number.isFinite(low))
    && (high === undefined || Number.isFinite(high)) && !(low !== undefined && high !== undefined && low > high);
  const apply = () => { if (valid) field.onFilterChange({ kind: "number", min: low, max: high }); };
  return <div className="space-y-2" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }}>
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1"><Label htmlFor={`${id}-min`} className="text-xs">{m.min}</Label>
        <Input id={`${id}-min`} type="number" step={field.step ?? "any"} value={min} disabled={field.disabled}
          onChange={event => setMin(event.target.value)} className="h-8 min-w-0 px-2 text-xs" /></div>
      <div className="space-y-1"><Label htmlFor={`${id}-max`} className="text-xs">{m.max}</Label>
        <Input id={`${id}-max`} type="number" step={field.step ?? "any"} value={max} disabled={field.disabled}
          onChange={event => setMax(event.target.value)} className="h-8 min-w-0 px-2 text-xs" /></div>
    </div>
    {(min || max) && !valid ? <p role="status" className="text-xs text-rose">{m.rangeInvalid}</p> : null}
    <Button type="button" variant="secondary" size="sm" className="h-7 w-full text-xs" disabled={field.disabled || !valid} onClick={apply}>{m.apply}</Button>
  </div>;
}

function DateRange({ field, locale }: { field: DashboardFieldControl; locale: string }) {
  const m = dashboardFieldMessages(locale), id = useId();
  const initial = field.filter?.kind === "date" ? field.filter : null;
  const [from, setFrom] = useState(initial?.from ?? "");
  const [to, setTo] = useState(initial?.to ?? "");
  const valid = validDashboardDateRange({ from, to });
  return <div className="space-y-2 border-t border-line pt-2">
    <div className="space-y-1"><Label htmlFor={`${id}-from`} className="text-xs">{m.from}</Label>
      <DateTimePicker id={`${id}-from`} mode="date" value={from} onValueChange={setFrom} disabled={field.disabled} className="h-8 px-2 text-xs" /></div>
    <div className="space-y-1"><Label htmlFor={`${id}-to`} className="text-xs">{m.to}</Label>
      <DateTimePicker id={`${id}-to`} mode="date" value={to} onValueChange={setTo} disabled={field.disabled} className="h-8 px-2 text-xs" /></div>
    {from && to && !valid ? <p role="status" className="text-xs text-rose">{m.rangeInvalid}</p> : null}
    <Button type="button" size="sm" variant="secondary" className="h-7 w-full text-xs" disabled={field.disabled || !valid}
      onClick={() => field.onFilterChange({ kind: "date", from, to })}>{m.apply}</Button>
  </div>;
}

function DateField({ field, context }: { field: DashboardFieldControl; context: DashboardDateContext }) {
  const m = dashboardFieldMessages(context.locale);
  const [grain, setGrain] = useState<DashboardDateGrain>("day");
  const ranges = new Map(field.days.map(day => {
    const range = dashboardDateBucket(day, grain, context.timeZone);
    return [range.from, range];
  }));
  return <div className="space-y-2">
    <ToggleGroup type="single" value={grain} aria-label={`${field.label} · ${m.fields}`} className="justify-start gap-0.5"
      onValueChange={value => { if (DASHBOARD_DATE_GRAINS.includes(value as DashboardDateGrain)) setGrain(value as DashboardDateGrain); }}>
      {DASHBOARD_DATE_GRAINS.map(value => <ToggleGroupItem key={value} value={value} className="h-7 min-w-0 px-2 text-xs">{m[value]}</ToggleGroupItem>)}
    </ToggleGroup>
    <Command className="h-auto rounded-none">
      <CommandInput placeholder={m.choices} aria-label={`${field.label} · ${m.choices}`} className="h-8 text-xs" />
      <CommandList className="max-h-40" aria-label={field.label}>
        <CommandEmpty className="py-3 text-xs">{m.noOptions}</CommandEmpty>
        {[...ranges.values()].map(range => {
          const selected = field.filter?.kind === "date" && field.filter.from === range.from && field.filter.to === range.to;
          const label = dashboardDateBucketLabel(range, grain, context);
          return <CommandItem key={range.from} value={`${range.from} ${range.to} ${label}`} className="py-1.5 text-xs"
            data-field-date-from={range.from} data-field-date-to={range.to} aria-checked={selected}
            onSelect={() => field.onFilterChange(selected ? undefined : { kind: "date", ...range })}>
            <Check aria-hidden className={selected ? "text-leaf-deep" : "opacity-0"} /><span>{label}</span>
          </CommandItem>;
        })}
      </CommandList>
    </Command>
    <DateRange key={JSON.stringify(field.filter ?? null)} field={field} locale={context.locale} />
  </div>;
}

function EnumField({ field, locale }: { field: DashboardFieldControl; locale: string }) {
  const m = dashboardFieldMessages(locale);
  const chosen = field.filter?.kind === "enum" ? field.filter.values : [];
  return <Command className="h-auto rounded-none">
    <CommandInput placeholder={m.choices} aria-label={`${field.label} · ${m.choices}`} className="h-8 text-xs" />
    <CommandList className="max-h-64" aria-label={field.label} aria-multiselectable={field.multiple}>
      <CommandEmpty className="py-3 text-xs">{m.noOptions}</CommandEmpty>
      {field.options.map(option => <CommandItem key={option.value} value={`${option.label} ${option.value}`}
        data-field-option={option.value} aria-checked={chosen.includes(option.value)} className="py-1.5 text-xs"
        onSelect={() => {
          const values = chosen.includes(option.value) ? chosen.filter(value => value !== option.value)
            : field.multiple === false ? [option.value] : [...chosen, option.value];
          field.onFilterChange(values.length ? { kind: "enum", values } : undefined);
        }}>
        <Check aria-hidden className={chosen.includes(option.value) ? "text-leaf-deep" : "opacity-0"} />
        <span className="min-w-0 whitespace-normal break-words">{option.label}</span>
      </CommandItem>)}
    </CommandList>
  </Command>;
}

function FieldPanel({ field, context, selected }: { field: DashboardFieldControl; context: DashboardDateContext; selected: boolean }) {
  const m = dashboardFieldMessages(context.locale), id = useId();
  return <section data-table-field={field.id} aria-label={field.label}
    className={cn("min-w-0 flex-col gap-2 p-3", selected ? "flex" : "hidden md:flex")}>
    <div className="flex min-h-7 items-center gap-1">
      <h3 className="min-w-0 flex-1 text-xs font-medium">{field.label}</h3>
      {field.sortable ? <ToggleGroup type="single" value={field.sortDirection ?? ""} disabled={field.disabled}
        onValueChange={value => field.onSortChange(value === "asc" || value === "desc" ? value : undefined)}
        className="shrink-0 gap-0" aria-label={`${field.label} · ${m.sortHint}`}>
        <ToggleGroupItem value="asc" className="size-7 min-w-0 p-0" aria-label={`${field.label} · ${m.ascending}`} title={m.ascending}><ArrowUp className="size-3.5" /></ToggleGroupItem>
        <ToggleGroupItem value="desc" className="size-7 min-w-0 p-0" aria-label={`${field.label} · ${m.descending}`} title={m.descending}><ArrowDown className="size-3.5" /></ToggleGroupItem>
      </ToggleGroup> : null}
      {field.filter ? <Button type="button" variant="ghost" size="sm" className="size-7 shrink-0 p-0"
        aria-label={`${field.label} · ${m.clearField}`} title={m.clearField} onClick={() => field.onFilterChange(undefined)}><RotateCcw className="size-3" /></Button> : null}
    </div>
    {field.hint ? <p id={`${id}-hint`} className="text-[11px] leading-4 text-muted">{field.hint}</p> : null}
    <PresenceControl field={field} locale={context.locale} />
    {field.kind === "text" ? <Input aria-label={`${field.label} · ${m.search}`} aria-describedby={field.hint ? `${id}-hint` : undefined}
      placeholder={m.search} value={field.filter?.kind === "text" ? field.filter.query : ""} maxLength={160} disabled={field.disabled}
      onChange={event => field.onFilterChange(event.target.value ? { kind: "text", query: event.target.value } : undefined)} className="h-8 text-xs" /> : null}
    {field.kind === "enum" ? <EnumField field={field} locale={context.locale} /> : null}
    {field.kind === "date" ? <DateField field={field} context={context} /> : null}
    {field.kind === "number" ? <NumberRange key={JSON.stringify(field.filter ?? null)} field={field} locale={context.locale} /> : null}
  </section>;
}

/** 一个主表列只打开一层 Popover；逻辑字段各自持有检索、条件和排序。 */
export function DashboardTableFieldMenu({ label, fields, context, onClearColumn, onClearAll }: DashboardTableFieldHeaderProps) {
  const m = dashboardFieldMessages(context.locale);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(fields[0]?.id);
  const filtered = fields.some(field => field.filter);
  const sorted = fields.find(field => field.sortDirection);
  const direction = sorted?.sortDirection === "asc" ? m.ascending : m.descending;
  const panelColumns = fields.length === 4 ? 4 : Math.min(3, fields.length);
  return <div className="-ml-2 inline-flex max-w-full items-center">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm"
        className="h-7 min-w-0 gap-1 px-2 text-xs font-medium text-muted hover:text-ink"
        data-dashboard-table-menu data-dashboard-table-filter aria-label={`${label} · ${m.menu}`} title={sorted ? `${sorted.label} · ${direction}` : m.menu}>
        <span className="truncate">{label}</span><ListFilter className={cn("size-3.5 shrink-0", filtered && "text-rose")} />
        {sorted ? sorted.sortDirection === "asc" ? <ArrowUp className="size-3 shrink-0 text-leaf-deep" /> : <ArrowDown className="size-3 shrink-0 text-leaf-deep" /> : null}
      </Button></PopoverTrigger>
      <PopoverContent align="start" className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
        style={{ width: `min(${panelColumns * 16}rem, calc(100vw - 1.5rem))` }} aria-label={`${label} · ${m.menu}`} data-dashboard-field-menu>
        {fields.length > 1 ? <ToggleGroup type="single" value={selected} onValueChange={value => { if (value) setSelected(value); }}
          aria-label={m.fields} className="justify-start overflow-x-auto border-b border-line p-2 md:hidden">
          {fields.map(field => <ToggleGroupItem key={field.id} value={field.id} className="h-7 shrink-0 px-2 text-xs">{field.label}{field.filter ? " ·" : ""}</ToggleGroupItem>)}
        </ToggleGroup> : null}
        <div className={cn("grid divide-line md:divide-x", panelColumns === 1 ? "md:grid-cols-1" : panelColumns === 2 ? "md:grid-cols-2" : panelColumns === 4 ? "md:grid-cols-4" : "md:grid-cols-3")}>
          {fields.map(field => <FieldPanel key={field.id} field={field} context={context} selected={selected === field.id} />)}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-line px-2 py-1.5">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearColumn}>{m.clearColumn}</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearAll}>{m.clearAll}</Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>;
}
