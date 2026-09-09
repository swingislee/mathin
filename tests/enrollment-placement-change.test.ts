// @vitest-environment jsdom
import { act,createElement,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { EnrollmentPlacementChangeDialog } from '@/features/school/EnrollmentPlacementChangeDialog';
import { placementChangeSchema } from '@/features/school/enrollment-placement-change-contract';
import type { PlacementStudent,PlacementClassroom } from '@/features/school/enrollment-workflow-contract';

const calls=vi.hoisted(()=>({preview:vi.fn(),save:vi.fn(),close:vi.fn(),saved:vi.fn()}));
vi.mock('@/features/school/enrollment-placement-change-actions',()=>({previewEnrollmentSessionTransferAction:calls.preview,changeEnrollmentPlacementAction:calls.save}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const student:PlacementStudent={key:id(1),studentId:id(1),membershipId:id(2),enrollmentId:id(3),classroomId:id(4),name:'小林',phone:'',grade:3,courseId:id(5),courseTitle:'数学',termId:id(6),note:'',recommendation:'',seat:2,status:'active'};
const classroom:PlacementClassroom={id:id(7),name:'目标班',courseId:id(5),termId:id(6),capacity:6,activeCount:0,teacherNames:'教师',sessions:[],operationalStatus:'active'};
const target={classroom,seat:4};
let cleanup=async()=>{};
beforeEach(()=>{
  vi.clearAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.stubGlobal('crypto',{getRandomValues:globalThis.crypto.getRandomValues.bind(globalThis.crypto)});
  calls.preview.mockResolvedValue({ok:true,data:[{sessionId:id(8),sourceSessionId:id(9),lectureNo:1,title:'可调讲次',scheduledAt:null,sourceScheduledAt:null,version:'fresh-one',blocked:null},
    {sessionId:id(10),sourceSessionId:id(11),lectureNo:2,title:'锁定讲次',scheduledAt:null,sourceScheduledAt:null,version:'fresh-two',blocked:'SESSION_LOCKED'}]});
  calls.save.mockResolvedValue({ok:false,code:'PLACEMENT_CHANGED'});
});
afterEach(async()=>{await cleanup();vi.unstubAllGlobals();});
async function mount(child:ReactNode){const element=document.createElement('div');document.body.append(element);const root=createRoot(element);cleanup=async()=>{await act(async()=>root.unmount());element.remove();};const props={locale:'zh',messages:{},timeZone:'Asia/Shanghai',children:child};await act(async()=>root.render(createElement(NextIntlClientProvider,props)));}
function dialog(withdraw=false){return createElement(EnrollmentPlacementChangeDialog,{student,target:withdraw?undefined:target,withdraw,onClose:calls.close,onSaved:calls.saved});}
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
async function click(element:HTMLElement){await act(async()=>element.click());}
it('requires an explicit confirmation before permanent transfer',async()=>{
  await mount(dialog());expect(calls.save).not.toHaveBeenCalled();expect(calls.preview).not.toHaveBeenCalled();
  await click(button('确认调班'));
  expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({mode:'permanent',membershipId:student.membershipId,fromClassroomId:student.classroomId,toClassroomId:classroom.id,seat:4,expectedSeat:2,sessions:[]}));
});
it('sends only selected unlocked lessons and keeps the request ID on retry',async()=>{
  await mount(dialog());await click(document.querySelector<HTMLInputElement>('input[value="temporary"]')!);
  expect(calls.preview).toHaveBeenCalledWith({membershipId:student.membershipId,classroomId:classroom.id,seat:4});
  expect(button('确认调班').disabled).toBe(true);
  const checks=[...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];expect(checks).toHaveLength(2);expect(checks[1].disabled).toBe(true);
  await click(checks[0]);await click(button('确认调班'));
  const input=calls.save.mock.calls[0][0];expect(input.mode).toBe('temporary');expect(input.sessions).toEqual([{sessionId:id(8),version:'fresh-one'}]);
  await click(button('确认调班'));expect(calls.save.mock.calls[1][0].requestId).toBe(input.requestId);
});
it('cancels the dialog without changing placement',async()=>{
  await mount(dialog());await click(button('取消'));expect(calls.close).toHaveBeenCalledOnce();expect(calls.save).not.toHaveBeenCalled();
});
it('requires a withdrawal reason and submits the displayed membership',async()=>{
  await mount(dialog(true));expect(button('确认退课').disabled).toBe(true);
  const input=document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'时间冲突');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click(button('确认退课'));expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({mode:'withdraw',reason:'时间冲突',membershipId:student.membershipId,enrollmentId:student.enrollmentId,expectedSeat:2,toClassroomId:null}));
});
it('validates distinct selected sessions and rejects incomplete movement',()=>{
  const input={requestId:id(12),mode:'temporary',enrollmentId:null,membershipId:student.membershipId,fromClassroomId:student.classroomId,toClassroomId:classroom.id,seat:4,expectedSeat:2,reason:'',sessions:[{sessionId:id(8),version:'v'}]};
  expect(placementChangeSchema.safeParse(input).success).toBe(true);
  expect(placementChangeSchema.safeParse({...input,sessions:[...input.sessions,...input.sessions]}).success).toBe(false);
  expect(placementChangeSchema.safeParse({...input,toClassroomId:student.classroomId}).success).toBe(false);
  expect(placementChangeSchema.safeParse({...input,mode:'withdraw',sessions:[]}).success).toBe(false);
});

it('requires a reason and explicit confirmation for a mismatched class',async()=>{
  const mismatch={source:'3年级数学 · 秋季',destination:'4年级数学 · 春季'};
  await mount(createElement(EnrollmentPlacementChangeDialog,{student,target,mismatch,onClose:calls.close,onSaved:calls.saved}));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(mismatch.destination);
  expect(calls.save).not.toHaveBeenCalled();expect(button('确认插班').disabled).toBe(true);
  const input=document.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'已核对学生进度，安排插班');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await click(button('确认插班'));
  expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({allowMismatch:true,reason:'已核对学生进度，安排插班'}));
  await click(document.querySelector<HTMLInputElement>('input[value="temporary"]')!);
  expect(calls.preview).toHaveBeenCalledWith(expect.objectContaining({allowMismatch:true}));
});
it('supports pending mismatched placement and keeps non-matching blockers visible',async()=>{
  const pending={...student,membershipId:null,classroomId:null,seat:null};
  const mismatch={source:'原课程',destination:'目标课程'};
  await mount(createElement(EnrollmentPlacementChangeDialog,{student:pending,target,mismatch,blocked:'目标班级已满',onClose:calls.close,onSaved:calls.saved}));
  expect(document.querySelector('input[value="temporary"]')).toBeNull();
  expect(button('确认插班').disabled).toBe(true);
  expect(document.body.textContent).toContain('目标班级已满');
  const input={requestId:id(12),mode:'permanent',enrollmentId:student.enrollmentId,membershipId:null,fromClassroomId:null,toClassroomId:classroom.id,seat:4,expectedSeat:null,reason:'已核对',allowMismatch:true};
  expect(placementChangeSchema.safeParse(input).success).toBe(true);
  expect(placementChangeSchema.safeParse({...input,reason:''}).success).toBe(false);
  expect(placementChangeSchema.safeParse({...input,allowMismatch:'true'}).success).toBe(false);
});
