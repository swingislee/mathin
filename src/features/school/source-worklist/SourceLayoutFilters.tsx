'use client';

import type { ReactNode } from 'react';
import { tabsListClassName, tabsTriggerClassName } from '@/components/ui/tabs-styles';
import { workMessages, type PeriodField, type SourceLayout, type SourcePlacement } from './contract';
import { sourceGroupLabels } from './grouping';

export function SourceLayoutFilters({ data, kind, periodFields, locale, disabled, onChange, actions }: {
  data: SourceLayout; kind: SourcePlacement['kind']; periodFields: PeriodField[]; locale: string; disabled?: boolean;
  onChange: (change: Partial<Pick<SourceLayout,'periodField' | 'period' | 'group'>>) => void; actions?: ReactNode;
}) {
  const m = workMessages(locale), labels = sourceGroupLabels(kind, locale);
  const choice = (key: string, label: string, selected: string, onClick: () => void, count?: number) =>
    <button key={key} type="button" disabled={disabled} className={`${tabsTriggerClassName} gap-1.5 px-2 text-xs`} data-state={selected === key ? 'active' : 'inactive'} aria-current={selected === key ? 'page' : undefined} onClick={onClick}>
      {label}{count !== undefined ? <span className="text-[10px] tabular-nums text-muted">{count}</span> : null}
    </button>;
  return <>
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-2">
      {periodFields.length ? <>
        <select aria-label={m.periodBasis} value={data.periodField} disabled={disabled} onChange={event => onChange({ periodField: event.target.value as PeriodField, period: '', group: '' })} className="h-8 rounded-md border border-line bg-card px-2 text-xs">
          {periodFields.map(field => <option key={field} value={field}>{m.periods[field]}</option>)}
        </select>
        <nav aria-label={m.periods[data.periodField]} className={`${tabsListClassName} h-auto max-w-full justify-start overflow-x-auto gap-1`}>
          {data.periods.map(period => choice(period.key, period.key === 'unknown' ? m.unknownPeriod : period.key, data.period, () => onChange({ period: period.key, group: '' }), period.count))}
          {choice('all',m.allPeriods,data.period,() => onChange({ period: 'all', group: '' }))}
        </nav>
      </> : <span className="text-xs text-muted">{labels.group}{labels.subgroup ? ` → ${labels.subgroup}` : ''}</span>}
      {actions}
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line py-1.5">
      <span className="shrink-0 text-xs text-muted">{labels.group}</span>
      <nav aria-label={labels.group} className={`${tabsListClassName} h-auto max-w-full justify-start overflow-x-auto gap-1`}>
        {choice('all',m.allGroups,data.group,() => onChange({ group: 'all' }))}
        {data.groups.map(group => choice(group.key,group.key,data.group,() => onChange({ group: group.key }),group.count))}
      </nav>
    </div>
  </>;
}
