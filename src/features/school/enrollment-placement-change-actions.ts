'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { actionError,type ActionResult } from '@/lib/action-result';
import { authorizedClient } from './actions/guards';
import { parse } from './actions/schemas';
import { enrollmentWorkflowRpc,loadEnrollmentPlacementBoard } from './enrollment-workflow-data';
import type { EnrollmentPlacementBoard } from './enrollment-workflow-contract';
import { placementChangeSchema,sessionTransferOptionSchema,type PlacementChangeInput,type SessionTransferOption } from './enrollment-placement-change-contract';

const errors=['FORBIDDEN_SCOPE','FORBIDDEN','UNAUTHENTICATED','VALIDATION','PLACEMENT_CHANGED','CLASS_TARGET_MISMATCH','CLASS_NOT_AVAILABLE','CLASS_FULL','INVALID_SEAT','SEAT_OCCUPIED','TEMPORARY_SEAT_RESERVED','SESSION_LOCKED','SOURCE_SESSION_MISSING','SOURCE_SESSION_AMBIGUOUS','SESSION_TRANSFER_EXISTS','IDEMPOTENCY_CONFLICT','ENROLLMENT_NOT_ACTIVE'] as const;
export async function previewEnrollmentSessionTransferAction(input:{membershipId:string;classroomId:string;seat:number;allowMismatch?:boolean}):Promise<ActionResult<SessionTransferOption[]>>{
  try{
    const v=parse(z.object({membershipId:z.string().uuid(),classroomId:z.string().uuid(),seat:z.number().int().min(1).max(60),allowMismatch:z.boolean().default(false)}).strict(),input);
    await authorizedClient('enrollment.manage');
    return {ok:true,data:z.array(sessionTransferOptionSchema).parse(await enrollmentWorkflowRpc('preview_enrollment_session_transfer',{p_membership_id:v.membershipId,p_to_classroom_id:v.classroomId,p_seat:v.seat,p_allow_mismatch:v.allowMismatch}))};
  }catch(error){return actionError(error,errors);}
}
export async function changeEnrollmentPlacementAction(input:PlacementChangeInput):Promise<ActionResult<EnrollmentPlacementBoard>>{
  try{
    const {requestId,...v}=parse(placementChangeSchema,input);
    await authorizedClient('enrollment.manage');
    await enrollmentWorkflowRpc('change_enrollment_placement',{p_request_id:requestId,p_input:v});
    revalidatePath('/[locale]/dashboard/followups/enrollments','page');
    revalidatePath('/[locale]/dashboard/enrollments','page');
    revalidatePath('/[locale]/dashboard/students','layout');
    revalidatePath('/[locale]/dashboard/classes','layout');
    revalidatePath('/[locale]/classroom','layout');
    return {ok:true,data:await loadEnrollmentPlacementBoard()};
  }catch(error){return actionError(error,errors);}
}
