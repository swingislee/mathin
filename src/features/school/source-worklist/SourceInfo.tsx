import { AlertTriangle } from 'lucide-react';
import type { SourcePlacement } from './contract';

const promoterFields = ['推广兼职', '推广员', '确认人员', '跟进人员'];
const locationFields = ['获取地点', '获取位置', '采集地点'];

export function SourceInfo({ placement, locale }: { placement?: SourcePlacement; locale: string }) {
  if (!placement) return <span className="text-muted">—</span>;
  const en = locale.startsWith('en');
  const context = [...new Map(placement.context.map(item => [`${item.label}:${item.value}`, item])).values()];
  const values = (labels: string[]) => [...new Set(context.filter(item => labels.includes(item.label)).map(item => item.value))].join(' / ');
  const promoter = values(promoterFields), location = values(locationFields);
  const note = values(['来源备注', '获取信息', '备注']);
  const channel = placement.channel || (en ? 'Earlier source' : '历史来源');
  const attention = placement.attention;
  return <div className="space-y-1 text-[11px] leading-4" onClick={event => event.stopPropagation()}>
    {attention ? <p className="flex items-start gap-1 rounded border border-crater/50 bg-moon/40 px-1.5 py-1 text-ink" title={attention}>
      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{en ? 'Historical pending enrollment · check before first contact' : '历史待报 · 请核对后补首联'}</span>
    </p> : null}
    <p>{channel}{promoter ? ` · ${en ? 'Promoter' : '推广兼职'} ${promoter}` : ''}</p>
    {location ? <p className="line-clamp-2 text-muted" title={location}>{en ? 'Location' : '地点'}：{location}</p> : null}
    {note ? <p className="line-clamp-2 text-muted" title={note}>{note}</p> : null}
    <details><summary className="cursor-pointer text-muted">{en ? 'Source details' : '来源详情'}</summary>
      {attention ? <p className="mt-1 leading-5">{attention}</p> : null}
      <dl className="mt-1 space-y-1">{context.map((item, index) => <div key={`${item.label}:${index}`}>
        <dt className="text-muted">{item.label}</dt><dd className="whitespace-pre-wrap break-words">{item.value}</dd>
      </div>)}</dl>
    </details>
  </div>;
}
