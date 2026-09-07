import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { BusinessHistorySections } from './BusinessHistorySections';
import { StudentSourceRecords } from './StudentSourceRecords';
import { BUSINESS_HISTORY_KINDS, type BusinessHistoryKind } from './student-business-history-contract';
import { loadStudentBusinessHistory } from './student-business-history-data';
import { getStudentBusinessHistoryMessages } from './student-business-history-messages';

export async function StudentBusinessHistoryTab({studentId,locale,kind,sourcePage=1}:{studentId:string;locale:string;kind?:BusinessHistoryKind;sourcePage?:number;current:{status:string;gender:string;grade:number|null}}) {
  const m=getStudentBusinessHistoryMessages(locale);
  const data=await loadStudentBusinessHistory(locale,{studentId,kind});
  const base=`/dashboard/students/${studentId}?tab=history`;
  return <div className="min-w-0 space-y-5">
    {data&&<nav aria-label={m.title} className="flex flex-wrap gap-1">
      <Link href={base} aria-current={!kind?'page':undefined} className={buttonVariants({variant:!kind?'secondary':'ghost',size:'sm'})}>{m.all}</Link>
      {BUSINESS_HISTORY_KINDS.map(item=><Link key={item} href={`${base}&history=${item}`} aria-current={kind===item?'page':undefined} className={buttonVariants({variant:kind===item?'secondary':'ghost',size:'sm'})}>{m[item]}</Link>)}
    </nav>}
    {data&&<BusinessHistorySections data={data} locale={locale} kind={kind}/>}
    <StudentSourceRecords studentId={studentId} locale={locale} page={sourcePage} kind={kind}/>
  </div>;
}
