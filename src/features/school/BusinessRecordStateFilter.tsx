'use client';
import { useState } from 'react';
import { useDashboardSearchQuery } from './dashboard-page/DashboardPreferenceScope';
import { type BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';

/** 旧调用点保持兼容；业务范围由学期、日期与工作进度控制。 */
export const BusinessRecordStateFilter: (props:{value:StateFilter;onChange:(value:StateFilter)=>void;locale:string;presentation?:'default'|'followup'})=>null = () => null;
export const HistoricalRecordBadge: (props:{locale:string})=>null = () => null;
export function useBusinessSearchQuery(key:string,initialQuery?:string):[string,(value:string)=>void] {
  const [stored,setStored]=useDashboardSearchQuery(key);
  const [override,setOverride]=useState(initialQuery);
  return [override??stored,value=>{setOverride(value);setStored(value);}];
}
