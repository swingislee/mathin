import {Badge} from '@/components/ui/badge';
import {sourceCompletionMessages,type SourceCompletionSummary} from './source-completion-contract';

export function SourceCompletionNotice({summary,locale,compact=false}:{summary:SourceCompletionSummary|null|undefined;locale:string;compact?:boolean}) {
  if(!summary)return null;
  const m=sourceCompletionMessages(locale);
  const pending=summary.missing.map(field=>m.missing[field]).join(locale.startsWith('en')?', ':'、');
  return <div data-source-completion className="min-w-0 text-xs">
    <div className="flex flex-wrap items-center gap-1">
      {(compact?[m.enrolled]:[m.contacted,m.assessed,m.enrolled]).map(label=><Badge key={label} variant="outline" className="border-leaf-deep/35 bg-leaf/20 px-1.5 text-[11px] text-leaf-deep">{label}</Badge>)}
      {summary.missing.length?<Badge variant="outline" title={pending} className="border-crater/40 bg-moon/40 px-1.5 text-[11px] text-ink">{m.pending}</Badge>:null}
    </div>
    {!compact?<>
      <p className="mt-2 text-[11px] leading-5 text-muted">{m.basis}</p>
      {summary.knownBand?<p className="mt-1 font-medium">{m.knownBand}：{summary.knownBand.replace('_plus','+').toUpperCase()}</p>:null}
      {summary.missing.length?<p data-source-missing-fields className="mt-1 text-[11px] leading-5 text-muted">{m.pending}：{pending}</p>:null}
    </>:null}
  </div>;
}
