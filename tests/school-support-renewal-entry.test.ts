// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { StudentStageEntry } from '@/features/school/StudentStageEntry';
import type { StudentStageRow } from '@/features/school/student-stage-contract';
import zh from '../messages/zh.json';

const calls=vi.hoisted(()=>({options:vi.fn(),save:vi.fn()}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock('@/i18n/navigation',()=>({Link:()=>null}));
vi.mock('@/features/school/student-stage-actions',()=>({getStudentStageOptionsAction:calls.options,saveStudentStageEntryAction:calls.save}));
const student='10000000-0000-4000-8000-000000000001',course='10000000-0000-4000-8000-000000000002',term='10000000-0000-4000-8000-000000000003',opportunity='10000000-0000-4000-8000-000000000004';
const row:StudentStageRow={key:`student:${student}`,studentId:student,leadId:null,name:'Old student',phone:'',grade:null,gradeText:'',ownerId:'actor',ownerName:'',
  stage:'awaiting_first_contact',detail:'not_contacted',note:'',lastContactAt:null,nextContactAt:null,score:null,assessmentBand:null,assessmentAt:null,registrationId:null,
  courseTitle:'',termName:'',courseId:null,termId:null,createdAt:'2026-09-08T00:00:00Z',canWrite:true,canContact:false,invitation:null};
let cleanup=async()=>{};
afterEach(async()=>{await cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('records a manually added renewal using its chosen course and term even when historical enrollment is missing',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  calls.options.mockResolvedValue({ok:true,data:{row,invitations:{activities:[],assessors:[]},enrollment:{courses:[{id:course,title:'Course',grade:3,productCode:null,classType:''}],terms:[{id:term,name:'Term',isCurrent:true}],classrooms:[]},
    opportunities:[{id:opportunity,course_id:course,term_id:term,opportunity_type:'renewal',stage:'planning',updated_at:row.createdAt}]}});
  calls.save.mockResolvedValue({ok:false,code:'NETWORK'});
  vi.stubGlobal('fetch',vi.fn(async(_url:string,init:RequestInit)=>({ok:true,json:async()=>calls.options(JSON.parse(String(init.body)))})));
  const ref=createRef<{save:()=>void}>();
  const provider={locale:'zh',messages:zh,timeZone:'Asia/Shanghai',children:createElement(StudentStageEntry,{row,locale:'zh',currentUserId:'actor',requestedMode:'enrollment',canEnroll:true,
    enrollmentContext:{type:'renewal',courseId:course,termId:term},canAdvance:false,outcomeRequest:null,onBusyChange:vi.fn(),onSaved:vi.fn(),ref})};
  await act(async()=>root.render(createElement(NextIntlClientProvider,provider)));
  await act(async()=>ref.current?.save());await act(async()=>ref.current?.save());
  expect(calls.save).toHaveBeenCalledTimes(2);
  expect(calls.save.mock.calls[0][1]).toMatchObject({studentId:student,mode:'enrollment',enrollment:{type:'renewal',courseId:course,termId:term,expectedOpportunityId:opportunity,confirm:false}});
  expect(calls.save.mock.calls[1][0]).toBe(calls.save.mock.calls[0][0]);
});
