'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDashboardSearchQuery } from './dashboard-page/DashboardPreferenceScope';
import { businessRecordMessages, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';

export function BusinessRecordStateFilter({value,onChange,locale}:{value:StateFilter;onChange:(value:StateFilter)=>void;locale:string}) {
  const m=businessRecordMessages(locale);
  return <Select value={value} onValueChange={value=>onChange(value as StateFilter)}>
    <SelectTrigger className="h-8 w-32 text-xs" aria-label={m.state}><SelectValue/></SelectTrigger>
    <SelectContent>{(['all','current','historical'] as const).map(value=><SelectItem key={value} value={value}>{m[value]}</SelectItem>)}</SelectContent>
  </Select>;
}
export function HistoricalRecordBadge({locale}:{locale:string}) {
  return <Badge variant="outline" className="shrink-0 text-[10px] text-muted">{businessRecordMessages(locale).historical}</Badge>;
}
export function useBusinessSearchQuery(key:string,initialQuery?:string):[string,(value:string)=>void] {
  const [stored,setStored]=useDashboardSearchQuery(key);
  const [override,setOverride]=useState(initialQuery);
  return [override??stored,value=>{setOverride(value);setStored(value);}];
}
