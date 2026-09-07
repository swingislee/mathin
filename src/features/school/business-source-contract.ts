/** 来源表达进入既有业务字段；无法唯一对应的值保留为备注。 */
export const CURRENT_ASSESSMENT_BANDS = ['x_plus', 'g_plus', 'a', 'a_plus', 's', 'c'] as const;
export type CurrentAssessmentBand = (typeof CURRENT_ASSESSMENT_BANDS)[number];

export function normalizeSourceAssessmentBand(value: unknown): CurrentAssessmentBand | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().replace(/\s+/g, '').replace(/＋/g, '+').toUpperCase();
  const values: Record<string, CurrentAssessmentBand> = {
    'X+': 'x_plus', X_PLUS: 'x_plus', 'G+': 'g_plus', G_PLUS: 'g_plus',
    A: 'a', 'A+': 'a_plus', A_PLUS: 'a_plus', S: 's', C: 'c',
  };
  return values[key] ?? null;
}

export function sourceAssessmentNote(value: unknown, field = '测评等级'): string {
  if (typeof value !== 'string' || !value.trim() || normalizeSourceAssessmentBand(value)) return '';
  return `原${field}：${value === 'below_a' ? '未达A' : value.trim()}`;
}

export function normalizeSourceBoolean(value: string, yes: readonly string[], no: readonly string[]): boolean | null {
  const text = value.trim();
  return yes.includes(text) ? true : no.includes(text) ? false : null;
}

export function normalizeSourceContact(value: string): {
  outcome: 'unreachable' | 'connected' | 'declined' | 'invalid_number' | null;
  wechatAdded: boolean | null;
  visitCommitted: boolean | null;
  note: string;
} {
  const parts = value.split(/[、,，]/).map(part => part.trim()).filter(Boolean);
  const connected = parts.some(part => ['加V', '诺访', '已沟通', '已联系'].includes(part));
  const unreachable = parts.some(part => ['未通', '未接通'].includes(part));
  const declined = parts.some(part => ['下期次再联系', '暂缓', '下次联系'].includes(part));
  const invalid = parts.some(part => ['号码无效', '无效号码'].includes(part));
  const contradictory = Number(connected) + Number(unreachable) + Number(declined) + Number(invalid) > 1;
  const outcome = contradictory ? null : connected ? 'connected' : unreachable ? 'unreachable' : declined ? 'declined' : invalid ? 'invalid_number' : null;
  return { outcome, wechatAdded: parts.includes('加V') ? true : null, visitCommitted: parts.includes('诺访') ? true : null,
    note: value.trim() && (!outcome || parts.some(part => !['加V', '诺访', '已沟通', '已联系', '未通', '未接通', '下期次再联系', '暂缓', '下次联系', '号码无效', '无效号码'].includes(part))) ? `原联系结果：${value.trim()}` : '' };
}

export function sourceScore(value: string): { score: number | null; maxScore: number | null; note: string } {
  const text = value.trim();
  if (!text) return { score: null, maxScore: null, note: '' };
  const match = /^(\d+(?:\.\d+)?)\s*(?:分)?(?:\s*[/／]\s*(\d+(?:\.\d+)?)\s*(?:分)?)?$/.exec(text);
  if (!match) return { score: null, maxScore: null, note: `原测评分数：${text}` };
  const score = Number(match[1]), maxScore = match[2] ? Number(match[2]) : null;
  if (score > 10000 || maxScore !== null && (maxScore <= 0 || score > maxScore)) return { score: null, maxScore: null, note: `原测评分数：${text}` };
  return { score, maxScore, note: '' };
}

export function mergeSourceNotes(...values: (string | null | undefined)[]): string {
  return [...new Set(values.flatMap(value => value?.split(/\r?\n/) ?? []).map(line => line.trim()).filter(Boolean))].join('\n');
}

export function businessDisplayDate(scheduledAt: string | null | undefined, occurredOn: string | null | undefined, locale: string, empty = '—'): string {
  if(scheduledAt && /^\d{4}-\d{2}-\d{2}$/.test(scheduledAt))return scheduledAt;
  if (scheduledAt && Number.isFinite(new Date(scheduledAt).getTime())) return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(scheduledAt));
  return occurredOn || empty;
}
