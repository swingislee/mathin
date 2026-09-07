'use client';
import { useState } from 'react';
import { useDashboardSearchQuery } from './dashboard-page/DashboardPreferenceScope';
import { businessRecordMessages, type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';
import { FollowupPrimaryFilter } from './FollowupPrimaryFilter';

/** 当前工作默认独立展示，历史与全部记录由用户主动选择。 */
export function BusinessRecordStateFilter({value,onChange,locale}:{value:StateFilter;onChange:(value:StateFilter)=>void;locale:string;presentation?:'default'|'followup'}) {
  const m=businessRecordMessages(locale);
  return <FollowupPrimaryFilter label={m.state} value={value} options={(['current','historical','all'] as const).map(value=>({value,label:m[value]}))}
    onValueChange={value=>onChange(value as StateFilter)}/>;
}
export const HistoricalRecordBadge: (props:{locale:string})=>null = () => null;
export function useBusinessSearchQuery(key:string,initialQuery?:string):[string,(value:string)=>void] {
  const [stored,setStored]=useDashboardSearchQuery(key);
  const [override,setOverride]=useState(initialQuery);
  return [override??stored,value=>{setOverride(value);setStored(value);}];
}
