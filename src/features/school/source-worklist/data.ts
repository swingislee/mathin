import 'server-only';
import { z } from 'zod';
import type { createClient } from '@/lib/supabase/server';
import { studentStageRowSchema, studentStageRpc } from '../student-stage-data';
import { parseFollowupFieldQuery } from '../followup-table-page';
import { studentListFacets, studentListFieldLabels, studentListRpcQuery } from '../student-list-query-contract';
import { markerSchema, placementSchema, PERIOD_FIELDS, type WorkQuery, type WorkPage } from './contract';
import { worklistFields } from './fields';

const pageSchema = z.object({ rows: z.array(studentStageRowSchema.extend({ worklist: placementSchema })),
  scope: z.enum(['all','mine','group','unassigned']), channels: z.array(z.object({ key: z.string(), count: z.number() })),
  count: z.number(), page: z.number(), pageSize: z.union([z.literal(20),z.literal(50),z.literal(100)]), totalPages: z.number(),
  periodField: z.union([z.enum(PERIOD_FIELDS),z.literal('')]), period: z.string(), group: z.string(), periods: z.array(z.object({ key: z.string(), count: z.number() })),
  groups: z.array(z.object({ key: z.string(), count: z.number(), subgroups: z.array(z.object({ key: z.string(), count: z.number() })) })), markers: z.array(markerSchema.extend({ count: z.number() })),
  counts: z.object({ awaiting_first_contact: z.number(), awaiting_assessment: z.number(), awaiting_enrollment: z.number(), awaiting_renewal: z.number(), former_student: z.number() }),
  facets: z.record(z.string(), z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })), days: z.array(z.string()) })),
  batches: z.array(z.object({ id: z.string(), label: z.string(), createdAt: z.string() })),
});

export async function loadWorklistPage(client: Awaited<ReturnType<typeof createClient>>, query: WorkQuery, locale: string, userId: string,
  { includeFacets = false, subjects = query.students ? query.students.split(',').map(id => 'student:' + id) : null }: { includeFacets?: boolean; subjects?: string[] | null } = {}): Promise<WorkPage> {
  const fields = worklistFields(locale, query.stage, userId);
  const fieldQuery = parseFollowupFieldQuery(fields, query.fields);
  const { facets, ...page } = pageSchema.parse(await studentStageRpc(client, 'school_communication_workbench_page', {
    p_stage: query.stage, p_scope: query.scope, p_search: query.q, p_group: query.group, p_marker: query.marker,
    p_page: query.page, p_page_size: query.pageSize, p_period_field: query.periodField, p_period: query.period,
    p_subjects: subjects, p_batch: query.batch || null, p_query: studentListRpcQuery(fieldQuery),
    p_locale: locale.startsWith('en') ? 'en' : 'zh', p_labels: studentListFieldLabels(fields), p_include_facets: includeFacets, p_facets_only: includeFacets,
    p_interest: query.interest ?? '', p_channel: query.channel ?? '',
  }));
  return { ...page, fieldView: { query: fieldQuery, facets: studentListFacets(facets, fields, locale), facetsDeferred: !includeFacets } };
}
