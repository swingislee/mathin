import { z } from 'zod';

export const statusEvidenceSchema = z.object({
  type: z.string(), value: z.string(), field: z.string(), excerpt: z.string(),
  priority: z.number(), certainty: z.enum(['confirmed','review']), date: z.string().nullable(),
  sourceId: z.string().nullable().optional(), recordId: z.string().optional(),
  logicalKey: z.string().nullable().optional(), phase: z.string().optional(),
  dateLabel: z.string().nullable().optional(), ordinal: z.number().optional(), version: z.number().optional(),
});
export type StatusEvidence = z.infer<typeof statusEvidenceSchema>;
export type StatusFacet = 'wechat' | 'interest' | 'visit' | 'assessment';
/** 名单只携带图标所需的结论；依据全文在打开弹层时按当前权限读取。 */
export interface RecordStatusSummary {
  facets: Array<{ facet: StatusFacet; value: string; review: boolean; stored: boolean }>;
  communicationTags: string[];
}
/** 阶段表随写入与导入整理的微信、意向、到访与测评等级；与小状态同源。 */
export interface StoredStatus { wechat: 'yes' | 'no' | null; interest: string | null; visit: 'arrived' | 'promised' | null; visitOn: string | null; band?: string | null }
export function storedStatusValue(stored: StoredStatus | null | undefined, facet: StatusFacet) {
  if (!stored) return null;
  return facet === 'assessment' ? stored.band ?? null : stored[facet];
}
const phases: Record<string, number> = { acquisition: 0, confirmation: 1, followup: 2, current: 3 };
function sameSource(a: StatusEvidence, b: StatusEvidence) {
  return Boolean(a.logicalKey && a.logicalKey === b.logicalKey || a.sourceId && a.sourceId === b.sourceId);
}
function supersedes(a: StatusEvidence, b: StatusEvidence) {
  if (a.priority >= 300 && b.priority < 300) return true;
  if (a.priority < 300 && b.priority >= 300) return false;
  if (a.date && b.date && a.date.slice(0,10) !== b.date.slice(0,10)) return a.date > b.date;
  if (sameSource(a,b) && a.phase && b.phase && a.phase in phases && b.phase in phases && phases[a.phase] > phases[b.phase]) return true;
  // 同一时点明确填写的字段优先于备注推断。
  return a.date === b.date && sameSource(a,b) && a.phase === b.phase && a.priority > b.priority;
}
export function resolveStatusEvidence(facts: StatusEvidence[], facet: StatusFacet | 'invitation_progress' | 'enrollment_progress' | 'followup_progress') {
  const matches = facts.filter(f => facet === 'assessment' ? ['assessment','assessment_band','assessment_score','learning_band'].includes(f.type) : f.type === facet);
  const ranked = [...matches].sort((a,b)=>b.priority-a.priority||(b.date??'').localeCompare(a.date??'')||a.field.localeCompare(b.field)||a.value.localeCompare(b.value));
  const confirmed = ranked.filter(f => f.certainty === 'confirmed');
  const authoritative = confirmed.some(f=>f.priority>=300) ? confirmed.filter(f=>f.priority>=300) : confirmed;
  const latest = authoritative.filter(f=>!authoritative.some(other=>other!==f&&supersedes(other,f)));
  const current = latest.length ? latest : authoritative;
  const type = facet === 'assessment' ? (current.some(f => f.type === 'assessment_band') ? 'assessment_band' : 'assessment') : facet;
  const candidates = current.filter(f => f.type === type);
  const best = candidates[0];
  const conflict = new Set(candidates.map(f=>f.value)).size>1 || Boolean(authoritative.length&&!latest.length);
  const unresolved = ranked.some(f => f.certainty === 'review' && f.value === 'conflicting' && (!best || !supersedes(best,f)));
  return { value: conflict ? 'conflicting' : best?.value ?? 'unknown',
    review: conflict || unresolved || (!best && ranked.some(f => f.certainty === 'review')),
    facts: ranked, best };
}
