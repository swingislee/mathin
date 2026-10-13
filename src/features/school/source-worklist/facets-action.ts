'use server';

import { z } from 'zod';
import { getMyPerms } from '@/lib/auth';
import { actionError } from '@/lib/action-result';
import { staffRpcClient } from '../actions/guards';
import { COMMON_CODES, parse } from '../actions/schemas';
import type { FollowupServerFields } from '../followup-table-page';
import { parseWorkQuery } from './contract';
import { loadWorklistPage } from './data';

const schema = z.object({ locale: z.enum(['zh','en']), query: z.record(z.string(), z.string().max(16_384)) });
export async function getWorklistFacetsAction(input: z.input<typeof schema>) {
  try {
    const value = parse(schema, input), { user, supabase } = await staffRpcClient();
    const permissions = await getMyPerms(user.id);
    const query = parseWorkQuery(value.query, permissions.has('student.view.all'), value.query.stage === 'awaiting_first_contact');
    const page = await loadWorklistPage(supabase, { ...query, page: 1, pageSize: 20 }, value.locale, user.id, { includeFacets: true });
    return { ok: true as const, data: page.fieldView.facets };
  } catch (error) { return actionError<FollowupServerFields['facets']>(error, ['FORBIDDEN_SCOPE', ...COMMON_CODES]); }
}
