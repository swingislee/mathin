// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { SchoolSupportAddButton } from '@/features/school/SchoolSupportEntry';

const calls=vi.hoisted(()=>({options:vi.fn(),search:vi.fn(),add:vi.fn(),replace:vi.fn(),refresh:vi.fn()}));
vi.mock('@/features/school/school-support-actions',()=>({getSupportOptionsAction:calls.options,searchSupportSubjectsAction:calls.search,addSupportWorkAction:calls.add}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({replace:calls.replace,refresh:calls.refresh})}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
let cleanup=async()=>{};
afterEach(async()=>{await cleanup();sessionStorage.clear();vi.unstubAllGlobals();});
it('keeps an incomplete student and the same request after a failed save, then opens the persisted renewal work',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});HTMLElement.prototype.scrollIntoView=vi.fn();
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  calls.options.mockResolvedValue({ok:true,data:{enrollment:{courses:[],terms:[],classrooms:[]},activities:[],currentUserId:'actor',canCreate:true,canEnroll:true}});
  calls.search.mockResolvedValue({ok:true,data:[]});
  calls.add.mockResolvedValueOnce({ok:false,code:'UNKNOWN'}).mockResolvedValueOnce({ok:true,data:{id:'saved-work',workspace:'renewals',name:'Old student',studentId:null,leadId:'lead'}});
  const provider={locale:'zh',messages:{},timeZone:'Asia/Shanghai',children:createElement(SchoolSupportAddButton,{workspace:'renewals'})};
  await act(async()=>root.render(createElement(NextIntlClientProvider,provider)));
  const button=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!;
  await act(async()=>button('补入学生').click());
  await act(async()=>button('未找到合适档案，按现有资料登记').click());
  const dialog=document.querySelector('[role="dialog"]')!;
  const name=[...dialog.querySelectorAll('label')].find(label=>label.textContent==='学生姓名')!.querySelector('input')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Old student');name.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>button('补入学生',dialog).click());
  expect(dialog.textContent).toContain('当前草稿已保留');
  expect(calls.add.mock.calls[0][1]).toMatchObject({workspace:'renewals',subject:null,newPerson:{name:'Old student',phone:'',identityPending:true,createStudent:false}});
  expect(sessionStorage.getItem('mathin:support-entry:v1:actor:renewals')).toContain('Old student');
  await act(async()=>button('补入学生',dialog).click());
  expect(calls.add.mock.calls[1]).toEqual(calls.add.mock.calls[0]);
  expect(sessionStorage.getItem('mathin:support-entry:v1:actor:renewals')).toBeNull();
  expect(calls.replace).toHaveBeenCalledWith('/dashboard/followups/renewals?manual=saved-work&state=current');
});
