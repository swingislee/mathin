"use server";

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { actionError, type ActionResult } from '@/lib/action-result';
import type { Json } from '@/lib/database.types';
import { authorizedClient } from './actions/guards';
import { parse, uuid } from './actions/schemas';
import { isRenewalHealthPolicy, type RenewalHealthPolicy } from './renewal-health-policy';

const schema = z.object({ cycleId: uuid, policy: z.custom<RenewalHealthPolicy>(isRenewalHealthPolicy), revision: z.number().int().min(0) });
export async function saveRenewalHealthPolicyAction(input: z.input<typeof schema>): Promise<ActionResult<number>> {
  try {
    const value = parse(schema, input);
    const { supabase } = await authorizedClient('followup.write');
    const { data, error } = await supabase.rpc('save_renewal_health_policy', {
      p_cycle_id: value.cycleId, p_policy: value.policy as unknown as Json, p_expected_revision: value.revision,
    });
    if (error) throw new Error(error.message);
    revalidatePath('/[locale]/dashboard/renewals', 'layout');
    return { ok: true, data: data! };
  } catch (error) { return actionError(error, ['VALIDATION', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_FOUND', 'POLICY_CHANGED']); }
}
