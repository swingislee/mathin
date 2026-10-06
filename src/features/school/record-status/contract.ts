import { z } from 'zod';

export const statusEvidenceSchema = z.object({
  type: z.string(), value: z.string(), field: z.string(), excerpt: z.string(),
  priority: z.number(), certainty: z.enum(['confirmed','review']), date: z.string().nullable(),
  sourceId: z.string().nullable().optional(), recordId: z.string().optional(),
});
export type StatusEvidence = z.infer<typeof statusEvidenceSchema>;
export type StatusFacet = 'wechat' | 'interest' | 'visit' | 'assessment';
export function resolveStatusEvidence(facts: StatusEvidence[], facet: StatusFacet) {
  const matches = facts.filter(f => facet === 'assessment' ? ['assessment','assessment_band','assessment_score','learning_band'].includes(f.type) : f.type === facet);
  const ranked = [...matches].sort((a,b) => b.priority-a.priority || (b.date ?? '').localeCompare(a.date ?? ''));
  const confirmed = ranked.filter(f => f.certainty === 'confirmed');
  const current = facet === 'assessment' && confirmed[0] ? confirmed.filter(f => f.priority === confirmed[0].priority && f.date === confirmed[0].date) : confirmed;
  const type = facet === 'assessment' ? (current.some(f => f.type === 'assessment_band') ? 'assessment_band' : 'assessment') : facet;
  const candidates = current.filter(f => f.type === type);
  const best = candidates[0];
  const ties = best ? candidates.filter(f => f.priority === best.priority && f.date === best.date) : [];
  const conflict = new Set(ties.map(f => f.value)).size > 1;
  return { value: conflict ? 'conflicting' : best?.value ?? 'unknown',
    review: conflict || (!best && ranked.some(f => f.certainty === 'review')),
    facts: ranked, best };
}
