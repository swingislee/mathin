'use client';
import { useState } from 'react';
import { useDashboardSearchQuery } from './dashboard-page/DashboardPreferenceScope';

/** 页面搜索词：地址参数优先，其次是本页记住的搜索。 */
export function useBusinessSearchQuery(key:string,initialQuery?:string):[string,(value:string)=>void] {
  const [stored,setStored]=useDashboardSearchQuery(key);
  const [override,setOverride]=useState(initialQuery);
  return [override??stored,value=>{setOverride(value);setStored(value);}];
}
