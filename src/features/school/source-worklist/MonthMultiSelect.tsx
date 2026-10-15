'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { workMessages, type SourceLayout } from './contract';
import { periodLabel } from './period-selection';

export function MonthMultiSelect({ data, locale, disabled, onChange }: {
  data: SourceLayout; locale: string; disabled?: boolean; onChange: (period: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const m = workMessages(locale), en = locale.startsWith('en');
  const current = data.period && data.period !== 'all' ? data.period.split(',') : [];
  const label = (key: string) => periodLabel(key, locale);
  const description = current.length ? current.map(label).join(en ? ', ' : '、') : m.allPeriods;
  const summary = current.length > 2 ? en ? `${current.length} months` : `${current.length} 个月` : description;
  // 零结果筛选仍保留已选月份，便于直接取消。
  const options = [...data.periods, ...current.filter(key => !data.periods.some(period => period.key === key)).map(key => ({ key, count: 0 }))];
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setSelected(current); }}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label={`${m.periods[data.periodField]}：${description}`} title={description}
        className="flex h-8 min-w-0 max-w-full items-center gap-2 rounded-md border border-line bg-card px-2 text-xs disabled:opacity-50">
        <span className="truncate">{summary}</span><ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-56 p-2" aria-label={m.periods[data.periodField]}>
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-line/30">
        <input type="checkbox" checked={selected.length === 0} onChange={() => setSelected([])} className="size-3.5 accent-ink" />{m.allPeriods}
      </label>
      <div className="max-h-64 overflow-y-auto border-t border-line py-1">
        {options.map(period => <label key={period.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-line/30">
          <input type="checkbox" checked={selected.includes(period.key)} className="size-3.5 accent-ink"
            onChange={() => setSelected(values => values.includes(period.key) ? values.filter(value => value !== period.key) : [...values, period.key])} />
          <span className="flex-1">{label(period.key)}</span><span className="tabular-nums text-muted">{period.count}</span>
        </label>)}
      </div>
      <div className="flex justify-end border-t border-line pt-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => {
          const period = options.filter(option => selected.includes(option.key)).map(option => option.key).join(',') || 'all';
          setOpen(false);
          if (period !== data.period) onChange(period);
        }}>{en ? 'Apply' : '应用'}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
