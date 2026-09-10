import { z } from 'zod';

export const BASE_BUSINESS_SECTIONS = /** @type {const} */ (['identity', 'acquisition', 'followup', 'confirmation', 'visit', 'assessment', 'enrollment', 'support', 'renewal', 'finance', 'teaching', 'competition', 'content', 'resources', 'operations', 'notes', 'reference', 'unmapped']);
export const baseBusinessFieldSchema = z.object({
  fieldId: z.string(), name: z.string(), section: z.enum(BASE_BUSINESS_SECTIONS), key: z.string(), kind: z.string(),
  value: z.json(), display: z.string(), originalText: z.string(), sourceType: z.string(), rawHasContent: z.boolean(),
  status: z.enum(['normalized', 'text', 'unparsed', 'reference', 'unmapped']),
});
export const baseBusinessFieldsSchema = z.array(baseBusinessFieldSchema);
export const baseLeadAcquisitionSchema = z.array(z.object({
  leadId: z.string(), sources: z.array(z.object({
    sourceId: z.string(), acquiredAt: z.string().nullable(), dateLabel: z.string(), location: z.string(),
    method: z.string(), promoter: z.string(), content: z.string(), group: z.string(),
  })),
}));
