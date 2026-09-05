"use server";
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { authorizedClient } from './actions/guards';
import { parse, uuid, text, money } from './actions/schemas';
import { actionError, type ActionResult } from '@/lib/action-result';
const schema = z.object({cycleId:uuid,membershipId:uuid,stage:z.enum(['considering','payment_pending','enrolled','not_enrolled','nurturing']),note:text(2000),periodCount:z.number().int().min(1).max(24).nullable(),paidAmount:money.positive().multipleOf(.01).nullable()});
export async function registerRenewalResultAction(input:z.input<typeof schema>):Promise<ActionResult> {
  try {
    const value=parse(schema,input);
    const {supabase}=await authorizedClient('followup.write');
    const {error}=await supabase.rpc('register_renewal_result',{p_cycle_id:value.cycleId,p_membership_id:value.membershipId,p_stage:value.stage,p_note:value.note,p_period_count:value.periodCount??undefined,p_paid_amount:value.paidAmount??undefined});
    if(error) throw new Error(error.message);
    revalidatePath('/[locale]/dashboard/renewals','layout');
    revalidatePath('/[locale]/dashboard/enrollments','page');
    return {ok:true};
  } catch(error) { return actionError(error,['VALIDATION','FORBIDDEN','FORBIDDEN_SCOPE','UNAUTHENTICATED','INVALID_CYCLE_STATE','OPPORTUNITY_ENROLLED','COURSE_REQUIRED','OWNER_NOT_AVAILABLE','FORBIDDEN_OWNER_ASSIGNMENT','INVALID_OPPORTUNITY_TRANSITION']); }
}
