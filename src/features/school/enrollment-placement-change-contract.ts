import { z } from 'zod';

const id=z.string().uuid();
export const sessionTransferOptionSchema=z.object({sessionId:id,sourceSessionId:id.nullable(),lectureNo:z.number().nullable(),title:z.string(),scheduledAt:z.string().nullable(),sourceScheduledAt:z.string().nullable(),version:z.string(),blocked:z.string().nullable()});
export type SessionTransferOption=z.infer<typeof sessionTransferOptionSchema>;
export const sessionTransferSchema=z.object({id,membershipId:id,studentId:id,name:z.string(),fromClassroomId:id,toClassroomId:id,classroomName:z.string(),seat:z.number(),lectureNo:z.number().nullable(),title:z.string(),scheduledAt:z.string().nullable()});
export type SessionTransfer=z.infer<typeof sessionTransferSchema>;
export const placementChangeSchema=z.object({requestId:id,mode:z.enum(['permanent','temporary','withdraw','cancel_temporary']),enrollmentId:id.nullable(),membershipId:id.nullable(),fromClassroomId:id.nullable(),toClassroomId:id.nullable(),seat:z.number().int().min(1).max(60).nullable(),expectedSeat:z.number().int().positive().nullable(),reason:z.string().trim().max(2000),allowMismatch:z.boolean().default(false),sessions:z.array(z.object({sessionId:id,version:z.string().min(1)}).strict()).max(100).default([]),transferId:id.nullable().default(null)}).strict()
  .superRefine((v,ctx)=>{
    if(!v.enrollmentId&&!v.membershipId)ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.allowMismatch&&(!v.reason||!['permanent','temporary'].includes(v.mode)))ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='withdraw'&&!v.reason)ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='temporary'&&(!v.sessions.length||new Set(v.sessions.map(s=>s.sessionId)).size!==v.sessions.length))ctx.addIssue({code:'custom',message:'VALIDATION'});
    if((v.mode==='permanent'||v.mode==='temporary')&&(!v.toClassroomId||v.fromClassroomId===v.toClassroomId||!v.seat||Boolean(v.membershipId)!==Boolean(v.fromClassroomId)||(v.mode==='temporary'&&!v.membershipId)))ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='cancel_temporary'&&(!v.membershipId||!v.transferId))ctx.addIssue({code:'custom',message:'VALIDATION'});
  });
export type PlacementChangeInput=z.input<typeof placementChangeSchema>;
export { placementChangeError } from "./enrollment-workflow-presentation";
