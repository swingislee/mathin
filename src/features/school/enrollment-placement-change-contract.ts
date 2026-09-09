import { z } from 'zod';

const id=z.string().uuid();
export const sessionTransferOptionSchema=z.object({sessionId:id,sourceSessionId:id.nullable(),lectureNo:z.number().nullable(),title:z.string(),scheduledAt:z.string().nullable(),sourceScheduledAt:z.string().nullable(),version:z.string(),blocked:z.string().nullable()});
export type SessionTransferOption=z.infer<typeof sessionTransferOptionSchema>;
export const sessionTransferSchema=z.object({id,membershipId:id,studentId:id,name:z.string(),fromClassroomId:id,toClassroomId:id,classroomName:z.string(),seat:z.number(),lectureNo:z.number().nullable(),title:z.string(),scheduledAt:z.string().nullable()});
export type SessionTransfer=z.infer<typeof sessionTransferSchema>;
export const placementChangeSchema=z.object({requestId:id,mode:z.enum(['permanent','temporary','withdraw','cancel_temporary']),enrollmentId:id.nullable(),membershipId:id.nullable(),fromClassroomId:id.nullable(),toClassroomId:id.nullable(),seat:z.number().int().min(1).max(60).nullable(),expectedSeat:z.number().int().positive().nullable(),reason:z.string().trim().max(2000),sessions:z.array(z.object({sessionId:id,version:z.string().min(1)}).strict()).max(100).default([]),transferId:id.nullable().default(null)}).strict()
  .superRefine((v,ctx)=>{
    if(!v.enrollmentId&&!v.membershipId)ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='withdraw'&&!v.reason)ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='temporary'&&(!v.sessions.length||new Set(v.sessions.map(s=>s.sessionId)).size!==v.sessions.length))ctx.addIssue({code:'custom',message:'VALIDATION'});
    if((v.mode==='permanent'||v.mode==='temporary')&&(!v.membershipId||!v.fromClassroomId||!v.toClassroomId||v.fromClassroomId===v.toClassroomId||!v.seat))ctx.addIssue({code:'custom',message:'VALIDATION'});
    if(v.mode==='cancel_temporary'&&(!v.membershipId||!v.transferId))ctx.addIssue({code:'custom',message:'VALIDATION'});
  });
export type PlacementChangeInput=z.input<typeof placementChangeSchema>;
export function placementChangeError(code:string,en:boolean){
  const errors:Record<string,[string,string]>={
    PLACEMENT_CHANGED:['分班或讲次安排已有变化，请重新打开确认。','Placement or sessions changed. Reopen to review.'],
    SESSION_LOCKED:['该讲次已开课、已有考勤或名单已锁定。','This session has started, has attendance, or its roster is locked.'],
    SOURCE_SESSION_MISSING:['原班还没有对应讲次，请先安排原班课次。','Schedule the matching lesson in the original class first.'],
    SOURCE_SESSION_AMBIGUOUS:['原班有多个相同讲次，请先核对排课。','The original class has multiple matching sessions. Review its schedule.'],
    SESSION_TRANSFER_EXISTS:['该讲次已有临时调班安排。','This lesson already has a temporary transfer.'],
    TEMPORARY_SEAT_RESERVED:['该座位已有临时调班预约，请选择其他座位。','This seat has a temporary reservation. Choose another seat.'],
    SEAT_OCCUPIED:['目标座位已被占用，请重新选择。','The target seat is occupied. Choose another seat.'],
    CLASS_FULL:['目标班级该讲次已满。','The target session is full.'],
    FORBIDDEN_SCOPE:['当前账号无法调整该班级。','You cannot manage this class.'],
    FORBIDDEN:['当前账号没有分班权限。','Enrollment management permission is required.'],
    CLASS_TARGET_MISMATCH:['请选择同一课程、同一学期的班级。','Choose a class in the same course and term.'],
  };
  return errors[code]?.[en?1:0]??(en?'Unable to save. Refresh and try again.':'保存未完成，请刷新后重试。');
}
