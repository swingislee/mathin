import { cn } from '@/lib/utils';
import { sourceDateNote, type SourceDateMarks } from './source-date-note';

/** 来源日期：年份按登记补全或只记月份时加虚线下划线说明由来；需要核对时附橙色“日期待核对”。 */
export function SourceDateText({ display, marks, locale, className }: {
  display: string; marks?: SourceDateMarks | null; locale: string; className?: string;
}) {
  const note = sourceDateNote(marks, locale);
  if (!note) return <span className={className}>{display}</span>;
  return <span className={cn('inline-flex items-center gap-1', className)} data-source-date-note={note.review ? 'review' : marks?.basis ?? ''}>
    <span title={note.text} className="cursor-help underline decoration-dotted underline-offset-2">{display}</span>
    {note.review || marks?.basis === 'month_only'
      ? <span title={note.text} className={cn('whitespace-nowrap rounded px-1 text-[10px] leading-4',
        note.review ? 'border border-crater/40 bg-moon/40 text-ink' : 'text-muted')}>{note.short}</span>
      : <span className="sr-only">{note.text}</span>}
  </span>;
}
