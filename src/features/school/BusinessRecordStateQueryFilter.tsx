'use client';
import { usePathname,useRouter } from '@/i18n/navigation';
import { BusinessRecordStateFilter } from './BusinessRecordStateFilter';
import type { BusinessRecordStateFilter as StateFilter } from './business-record-state-contract';

export function BusinessRecordStateQueryFilter({value,locale,query}:{value:StateFilter;locale:string;query:Record<string,string>}) {
  const router=useRouter();
  const pathname=usePathname();
  return <BusinessRecordStateFilter value={value} locale={locale} onChange={state=>{
    const next=new URLSearchParams(query);next.set('state',state);next.set('view','all');next.delete('page');
    router.replace(`${pathname}?${next}`);
  }}/>;
}
