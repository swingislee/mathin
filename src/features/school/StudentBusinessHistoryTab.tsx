import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { BusinessHistorySections } from './BusinessHistorySections';
import { ImportedFamilyHistoryPanel } from './ImportedFamilyHistoryPanel';
import { loadImportedFamilyHistory } from './history-import-trial-data';
import { BUSINESS_HISTORY_KINDS, type BusinessHistoryKind } from './student-business-history-contract';
import { loadStudentBusinessHistory } from './student-business-history-data';
import { getStudentBusinessHistoryMessages } from './student-business-history-messages';

export async function StudentBusinessHistoryTab({studentId,locale,kind,current}:{studentId:string;locale:string;kind?:BusinessHistoryKind;current:{status:string;gender:string;grade:number|null}}) {
  const m=getStudentBusinessHistoryMessages(locale);
  const [data,originals]=await Promise.all([loadStudentBusinessHistory(locale,{studentId,kind}),loadImportedFamilyHistory(locale,studentId)]);
  if(!data)return null;
  const base=`/dashboard/students/${studentId}?tab=history`;
  return <div className="min-w-0 space-y-5">
    <nav aria-label={m.title} className="flex flex-wrap gap-1">
      <Link href={base} aria-current={!kind?'page':undefined} className={buttonVariants({variant:!kind?'secondary':'ghost',size:'sm'})}>{m.all}</Link>
      {BUSINESS_HISTORY_KINDS.map(item=><Link key={item} href={`${base}&history=${item}`} aria-current={kind===item?'page':undefined} className={buttonVariants({variant:kind===item?'secondary':'ghost',size:'sm'})}>{m[item]}</Link>)}
    </nav>
    <BusinessHistorySections data={data} locale={locale} kind={kind}/>
    {originals&&<details className="text-sm">
      <summary className="cursor-pointer text-muted">{m.review}</summary>
      <p className="my-3 text-xs text-muted">{m.reviewHint}</p>
      <ImportedFamilyHistoryPanel data={originals} locale={locale} current={current}/>
    </details>}
  </div>;
}
