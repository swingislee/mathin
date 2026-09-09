// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SchoolSupportInsertion, SchoolSupportSeatEntry, SchoolSupportTableEntry } from '@/features/school/SchoolSupportInlineEntry';

const calls=vi.hoisted(()=>({options:vi.fn(),search:vi.fn(),add:vi.fn(),replace:vi.fn(),refresh:vi.fn()}));
vi.mock('@/features/school/school-support-actions',()=>({getSupportOptionsAction:calls.options,searchSupportSubjectsAction:calls.search,addSupportWorkAction:calls.add}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({replace:calls.replace,refresh:calls.refresh})}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
let cleanup=async()=>{};
const id='10000000-0000-4000-8000-000000000001', room='10000000-0000-4000-8000-000000000002';
beforeEach(()=>{
  vi.clearAllMocks(); Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); HTMLElement.prototype.scrollIntoView=vi.fn();
  calls.options.mockResolvedValue({ok:true,data:{enrollment:{courses:[{id,title:'Course'}],terms:[{id,name:'Term'}],classrooms:[]},activities:[],currentUserId:'actor',canCreate:true,canEnroll:true}});
  calls.search.mockResolvedValue({ok:true,data:[]});
});
afterEach(async()=>{await cleanup();sessionStorage.clear();vi.useRealTimers();});
async function mount(child:ReactNode){
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  const props={locale:'zh',messages:{},timeZone:'Asia/Shanghai',children:child};
  await act(async()=>root.render(createElement(NextIntlClientProvider,props)));
  return element;
}
async function table(open=true){
  const props:ComponentProps<typeof SchoolSupportTableEntry>={workspace:'communication',enabled:true,columns:['name','phone','grade','note'],initialWork:{date:'2026-09-09'},children:
    createElement('table',null,createElement('tbody',null,
      createElement('tr',{'data-existing':'before'},createElement('td',null,'Existing student')),
      createElement(SchoolSupportInsertion,{after:'before'}),
      createElement('tr',{'data-existing':'after'},createElement('td',null,'Next student')),
      createElement(SchoolSupportInsertion,{after:'after'}))) };
  const element=await mount(createElement(SchoolSupportTableEntry,props));
  const gutter=element.querySelector<HTMLElement>('[data-support-insertion-gutter]')!;
  vi.spyOn(gutter.parentElement!,'getBoundingClientRect').mockReturnValue(new DOMRect(40,100,500,180));
  element.querySelectorAll<HTMLElement>('[data-support-insertion]').forEach((anchor,index)=>{
    vi.spyOn(anchor,'getBoundingClientRect').mockReturnValue(new DOMRect(40,140+index*40,500,0));
  });
  if(open){
    await act(async()=>gutter.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:28,clientY:140})));
    await act(async()=>element.querySelector<HTMLButtonElement>('[aria-label="在此行下方补入学生"]')!.click());
  }
  return element;
}
const button=(text:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text)!;
async function fill(label:string,value:string){
  const input=document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
}
it('uses one gutter control outside the table and inserts at the hovered boundary',async()=>{
  const element=await table(false),gutter=element.querySelector<HTMLElement>('[data-support-insertion-gutter]')!;
  const plus=element.querySelector<HTMLButtonElement>('[aria-label="在此行下方补入学生"]')!;
  expect(plus.closest('table')).toBeNull();
  expect(plus.classList.contains('opacity-0')).toBe(true);
  await act(async()=>gutter.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:28,clientY:140})));
  expect(plus.dataset.supportInsertionTarget).toBe('before');
  await act(async()=>gutter.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:28,clientY:180})));
  expect(plus.dataset.supportInsertionTarget).toBe('after');
  expect(element.querySelectorAll('[data-support-insertion-target]')).toHaveLength(1);
  await act(async()=>gutter.dispatchEvent(new MouseEvent('pointerout',{bubbles:true,relatedTarget:document.body})));
  expect(plus.classList.contains('opacity-0')).toBe(true);
  expect(plus.classList.contains('transition-none')).toBe(true);
  await act(async()=>gutter.dispatchEvent(new MouseEvent('pointermove',{bubbles:true,clientX:28,clientY:180})));
  await act(async()=>plus.click());
  expect(element.querySelector('[data-support-insertion="after"]')?.nextElementSibling?.hasAttribute('data-support-entry-summary')).toBe(true);
});
it('inserts a blank summary and details below the chosen row, preserving the draft and request on failure',async()=>{
  calls.add.mockResolvedValueOnce({ok:false,code:'UNKNOWN'}).mockResolvedValueOnce({ok:true,data:{id:'saved-work',workspace:'communication',name:'Old student',studentId:null,leadId:'lead'}});
  const element=await table();
  const anchor=element.querySelector('[data-support-insertion="before"]')!;
  expect(anchor.previousElementSibling?.getAttribute('data-existing')).toBe('before');
  expect(anchor.nextElementSibling?.hasAttribute('data-support-entry-summary')).toBe(true);
  expect(anchor.nextElementSibling?.nextElementSibling?.querySelector('[data-support-entry-details]')).not.toBeNull();
  expect(element.querySelector<HTMLInputElement>('input[aria-label="学生姓名"]')?.value).toBe('');
  expect(element.querySelector('[role="dialog"]')).toBeNull();
  await fill('学生姓名','Old student');
  await fill('家长姓名','Parent'); await fill('家长电话','60000000998');
  await fill('学校','School'); await fill('微信','parent-wechat');
  await act(async()=>button('保存').click());
  expect(element.textContent).toContain('当前草稿已保留');
  expect(calls.add.mock.calls[0][1]).toMatchObject({workspace:'communication',subject:null,newPerson:{name:'Old student',phone:'',identityPending:true,createStudent:false,
    parentName:'Parent',parentPhone:'60000000998',school:'School',wechat:'parent-wechat'}});
  expect(sessionStorage.getItem('mathin:support-inline:v2:actor:communication::')).toContain('Old student');
  await act(async()=>button('保存').click());
  expect(calls.add.mock.calls[1]).toEqual(calls.add.mock.calls[0]);
  expect(sessionStorage.getItem('mathin:support-inline:v2:actor:communication::')).toBeNull();
  expect(calls.refresh).toHaveBeenCalled();
});
it('automatically matches the entered name and phone and explicitly reuses the selected profile',async()=>{
  vi.useFakeTimers();
  const candidate={studentId:id,leadId:null,version:'version',name:'Known child',phone:'60000000999',grade:3,parentName:'Parent',school:'School',ownerName:'Teacher',canWrite:true,phoneMatch:true,nameMatch:true};
  calls.search.mockResolvedValue({ok:true,data:[candidate]});
  calls.add.mockResolvedValue({ok:false,code:'UNKNOWN'});
  await table(); await fill('学生姓名','Known'); await fill('联系电话','60000000999');
  await fill('家长电话','60000000998'); await fill('微信','parent-wechat');
  await act(async()=>vi.advanceTimersByTimeAsync(260));
  expect(calls.search).toHaveBeenCalledWith('Known'); expect(calls.search).toHaveBeenCalledWith('60000000999');
  expect(calls.search).toHaveBeenCalledWith('60000000998'); expect(calls.search).toHaveBeenCalledWith('parent-wechat');
  expect(document.querySelectorAll('[data-support-candidates] li')).toHaveLength(1);
  await act(async()=>document.querySelector<HTMLButtonElement>('[data-support-candidates] li button')!.click());
  expect(document.querySelector<HTMLInputElement>('input[aria-label="学生姓名"]')?.value).toBe('Known child');
  await act(async()=>button('保存').click());
  expect(calls.add.mock.calls[0][1]).toMatchObject({newPerson:null,subject:{studentId:id,leadId:null,version:'version'}});
});
it('waits for the ninth phone digit and clears matches when the number becomes incomplete',async()=>{
  vi.useFakeTimers();
  await table(); await fill('学生姓名','Known'); await fill('联系电话','60000000');
  await act(async()=>vi.advanceTimersByTimeAsync(260));
  expect(calls.search).not.toHaveBeenCalled();
  expect(document.querySelector('[data-support-candidates]')?.textContent).toContain('请补完电话号码后搜索');
  await fill('联系电话','600000009');
  await act(async()=>vi.advanceTimersByTimeAsync(260));
  expect(calls.search).toHaveBeenCalledWith('600000009');
  calls.search.mockClear();
  await fill('联系电话','60000000');
  await act(async()=>vi.advanceTimersByTimeAsync(260));
  expect(calls.search).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[data-support-candidates] li')).toHaveLength(0);
});
it('keeps the chosen class and seat and requires a confirmed student for quick placement',async()=>{
  calls.add.mockResolvedValue({ok:false,code:'SEAT_OCCUPIED'});
  await mount(createElement(SchoolSupportSeatEntry,{open:true,onClose:vi.fn(),classroomName:'Class A',classroomId:room,courseId:id,termId:id,seat:2}));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Class A · 2 号位');
  await fill('学生姓名','New child');
  expect(button('保存并补入此座位').disabled).toBe(true);
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await act(async()=>button('保存并补入此座位').click());
  expect(calls.add.mock.calls[0][1]).toMatchObject({workspace:'enrollments',newPerson:{name:'New child',createStudent:true,identityPending:false},work:{classroomId:room,courseId:id,termId:id,seat:2}});
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('座位或花名册已更新');
  expect(document.querySelector<HTMLInputElement>('input[aria-label="学生姓名"]')?.value).toBe('New child');
});
