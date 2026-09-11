import { z } from 'zod';

export const BASE_BUSINESS_SECTIONS = /** @type {const} */ (['identity', 'acquisition', 'followup', 'confirmation', 'visit', 'assessment', 'enrollment', 'support', 'renewal', 'finance', 'teaching', 'competition', 'content', 'resources', 'operations', 'notes', 'reference', 'unmapped']);
export const baseBusinessFieldSchema = z.object({
  fieldId: z.string(), name: z.string(), section: z.enum(BASE_BUSINESS_SECTIONS), key: z.string(), kind: z.string(),
  value: z.json(), display: z.string(), originalText: z.string(), sourceType: z.string(), rawHasContent: z.boolean(),
  status: z.enum(['normalized', 'text', 'pending', 'unparsed', 'reference', 'unmapped']),
  review: z.array(z.enum(['unrecognized', 'missing', 'transition', 'multiple_grades', 'ambiguous', 'conflicting_options', 'time_period', 'scale', 'reference', 'class_label', 'field_mismatch', 'child_identity', 'record_scope'])).optional(),
  label: z.string().optional(),
  projections: z.array(z.object({ section: z.enum(BASE_BUSINESS_SECTIONS), key: z.string(), kind: z.string(), label: z.string(),
    value: z.json(), display: z.string(), status: z.enum(['normalized', 'text']) })).optional(),
});
export const baseBusinessFieldsSchema = z.array(baseBusinessFieldSchema);
export const baseLeadAcquisitionSchema = z.array(z.object({
  leadId: z.string(), sources: z.array(z.object({
    sourceId: z.string(), acquiredAt: z.string().nullable(), dateLabel: z.string(), location: z.string(),
    method: z.string(), promoter: z.string(), content: z.string(), group: z.string(),
  })),
}));
