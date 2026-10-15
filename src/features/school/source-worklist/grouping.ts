import type { SourcePlacement } from './contract';
import { periodLabel } from './period-selection';

/** 沟通与测评的客户端列表共用来源表分组层级。 */
export function sourceGroupLabels(kind: SourcePlacement['kind'], locale: string, mode?: SourcePlacement['groupMode']) {
  const en = locale.startsWith('en');
  if (mode) return { group: en ? 'Group' : '小组', subgroup: mode === 'support' ? en ? 'Learning support' : '学服' : '' };
  return kind === 'service' ? { group: en ? 'Teacher' : '授课老师', subgroup: en ? 'Class' : '班序' }
    : kind === 'assessment' ? { group: en ? 'Support teacher' : '学服老师', subgroup: '' }
    : { group: en ? 'Group' : '小组', subgroup: en ? 'Contact person' : '确认 / 跟进人员' };
}

export function sourceGroupPath(placement: SourcePlacement, allMonths: boolean, locale: string) {
  const labels = sourceGroupLabels(placement.kind, locale, placement.groupMode);
  const month = periodLabel(placement.period, locale);
  return [
    ...(allMonths ? [{ key: `month:${placement.period}`, label: month }] : []),
    { key: JSON.stringify(['group',placement.period,placement.group]), label: `${labels.group} · ${placement.group}` },
    ...(placement.subgroup ? [{ key: JSON.stringify(['person',placement.period,placement.group,placement.subgroup]), label: `${labels.subgroup} · ${placement.subgroup}` }] : []),
  ];
}
