import { buttonVariants } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { DashboardSection } from './dashboard-page';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import { loadStudentSourceArchive } from './source-use-data';
import { sourceUseMessages } from './source-use-contract';
import { SourceUseButton } from './SourceUseButton';

export async function StudentSourceRecords({studentId,locale,page=1,kind}:{studentId:string;locale:string;page?:number;kind?:string}) {
  if(!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV,process.env.NEXT_PUBLIC_SUPABASE_URL))return null;
  const data=await loadStudentSourceArchive(locale,studentId,page),m=sourceUseMessages(locale);
  const href=(next:number)=>`/dashboard/students/${studentId}?tab=history&sourcePage=${next}${kind?`&history=${kind}`:''}#student-source-records`;
  return <div id="student-source-records"><DashboardSection title={`${m.title} · ${data.total}`} description={m.hint}>
    {!data.total?<p className="text-sm text-muted">{m.empty}</p>:<div className="divide-y divide-line">{data.rows.map(row=><section key={row.id} className="space-y-3 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div>
        <h3 className="text-sm font-medium">{row.title}</h3>
        <p className="mt-1 text-xs text-muted">{row.dateLabel||m.unknown} · {row.linked?m.linked:m.pending}</p>
      </div>{row.linked||data.canConfirm?<SourceUseButton recordId={row.id} locale={locale} studentId={studentId} linked={row.linked}/>:null}</div>
      <details className="text-sm"><summary className="cursor-pointer text-muted">{m.original}</summary>
        <p className="my-3 break-words text-xs text-muted">{row.source}</p>
        <dl className="space-y-3">{row.cells.map((cell,index)=><div key={index}><dt className="text-xs text-muted">{cell.name}</dt><dd className="mt-1 whitespace-pre-wrap break-words leading-6">{cell.text}</dd></div>)}</dl>
      </details>
    </section>)}</div>}
    {data.total>data.pageSize?<div className="mt-4 flex justify-end gap-2">
      {page>1?<Link href={href(page-1)} className={buttonVariants({variant:'ghost',size:'sm'})}>{m.previous}</Link>:null}
      {page*data.pageSize<data.total?<Link href={href(page+1)} className={buttonVariants({variant:'ghost',size:'sm'})}>{m.next}</Link>:null}
    </div>:null}
  </DashboardSection></div>;
}
