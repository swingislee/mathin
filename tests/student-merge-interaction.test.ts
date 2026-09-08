// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StudentMergePanel } from '@/features/school/StudentMergePanel';
import type { StudentMergeProfile, StudentMergeReview } from '@/features/school/student-merge-contract';
const calls=vi.hoisted(()=>({search:vi.fn(),preview:vi.fn(),confirm:vi.fn(),history:vi.fn(),replace:vi.fn(),refresh:vi.fn()}));
vi.mock('@/features/school/student-merge-actions',()=>({searchStudentMergeCandidatesAction:calls.search,previewStudentMergeAction:calls.preview,confirmStudentMergeAction:calls.confirm,getStudentMergeHistoryAction:calls.history}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({replace:calls.replace,refresh:calls.refresh})}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
const kept='10000000-0000-4000-8000-000000000001',source='10000000-0000-4000-8000-000000000002',mergeId='10000000-0000-4000-8000-000000000003';
const profile=(id:string,name:string,phone:string):StudentMergeProfile=>({id,owner:'Teacher',createdAt:'2026-01-01T00:00:00Z',values:{name,phone,grade:3,parentPhone:'',parentName:'Parent',school:'School',wechat:'',region:'',source:'Manual',remark:'',status:'lead'}});
const keepProfile=profile(kept,'Kept child',''),sourceProfile=profile(source,'Earlier child','600000009911');
const review:StudentMergeReview={kept:keepProfile,merged:sourceProfile,token:'a'.repeat(32),accounts:null,counts:{communication:{kept:2,merged:3,preserved:0}},blockers:[]};
let cleanup=async()=>{};
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});HTMLElement.prototype.scrollIntoView=vi.fn();
  calls.search.mockResolvedValue({ok:true,data:[sourceProfile]});calls.preview.mockResolvedValue({ok:true,data:review});calls.history.mockResolvedValue({ok:true,data:[]});
  calls.confirm.mockResolvedValue({ok:true,data:{keptId:kept,mergedId:source,mergeId}});
});
afterEach(async()=>{await cleanup();vi.useRealTimers();});
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===label)!;
async function mount(){const element=document.createElement('div');document.body.append(element);const root=createRoot(element);cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  const props={locale:'zh',messages:{},timeZone:'Asia/Shanghai',children:createElement(StudentMergePanel,{studentId:kept,name:keepProfile.values.name,phone:''})};
  await act(async()=>root.render(createElement(NextIntlClientProvider,props)));return element;
}
async function open(){await mount();await act(async()=>button('合并档案').click());await act(async()=>vi.advanceTimersByTimeAsync(260));}
async function compare(){await open();await act(async()=>button('核对').click());}
async function confirmForm(){const area=document.querySelector('textarea')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(area,'Checked by parent and teacher');area.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());}
it('keeps a discoverable merge entry even when no automatic duplicate is found',async()=>{
  calls.search.mockResolvedValue({ok:true,data:[]});await mount();expect(button('合并档案')).toBeDefined();expect(calls.search).not.toHaveBeenCalled();
  await act(async()=>button('合并档案').click());await act(async()=>vi.advanceTimersByTimeAsync(260));
  expect(document.body.textContent).toContain('暂无匹配档案');expect(document.querySelector('input[aria-label="按姓名、电话、家长、学校或老师查找"]')).not.toBeNull();
  await act(async()=>button('取消').click());expect(calls.confirm).not.toHaveBeenCalled();
});
it('shows both exact identities, defaults to filling missing information, and waits for explicit confirmation',async()=>{
  await compare();const panel=document.querySelector('[data-student-merge-review]')!;
  expect(panel.textContent).toContain(kept);expect(panel.textContent).toContain(source);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="电话 · 合入档案"]')?.checked).toBe(true);
  expect(button('确认合并').disabled).toBe(true);expect(calls.confirm).not.toHaveBeenCalled();await confirmForm();
  await act(async()=>button('确认合并').click());
  expect(calls.confirm).toHaveBeenCalledWith(expect.objectContaining({keptId:kept,mergedId:source,token:'a'.repeat(32),choices:expect.objectContaining({phone:'merged'}),reason:'Checked by parent and teacher'}));
  expect(calls.refresh).toHaveBeenCalled();
});
it('retains field choices and reason on a stale preview and requires a fresh checked version',async()=>{
  calls.confirm.mockResolvedValueOnce({ok:false,code:'MERGE_CHANGED'}).mockResolvedValueOnce({ok:true,data:{keptId:kept,mergedId:source,mergeId}});
  await compare();await act(async()=>document.querySelector<HTMLInputElement>('input[aria-label="姓名 · 合入档案"]')!.click());await confirmForm();
  await act(async()=>button('确认合并').click());expect(document.body.textContent).toContain('预览后资料或记录已更新');expect(button('确认合并').disabled).toBe(true);
  calls.preview.mockResolvedValue({ok:true,data:{...review,token:'b'.repeat(32)}});
  await act(async()=>button('重新读取预览').click());
  expect(document.querySelector('textarea')?.value).toBe('Checked by parent and teacher');expect(document.querySelector<HTMLInputElement>('input[aria-label="姓名 · 合入档案"]')?.checked).toBe(true);
  expect(button('确认合并').disabled).toBe(true);await act(async()=>document.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click());
  await act(async()=>button('确认合并').click());expect(calls.confirm.mock.calls[1][0].token).toBe('b'.repeat(32));
});
it('presents record overlaps and prevents submitting a destructive merge',async()=>{
  calls.preview.mockResolvedValue({ok:true,data:{...review,blockers:[{kind:'overlap',category:'teaching',recordType:'session_attendance'}]}});
  await compare();expect(document.body.textContent).toContain('同课次考勤 · 存在重叠记录');expect(button('确认合并').disabled).toBe(true);
  await act(async()=>button('取消').click());expect(calls.confirm).not.toHaveBeenCalled();
});
it('can choose the other retained profile and navigates to that profile after success',async()=>{
  await compare();calls.preview.mockResolvedValue({ok:true,data:{...review,kept:sourceProfile,merged:keepProfile}});
  calls.confirm.mockResolvedValue({ok:true,data:{keptId:source,mergedId:kept,mergeId}});
  await act(async()=>button('交换保留档案').click());expect(calls.preview).toHaveBeenLastCalledWith(source,kept);
  await confirmForm();await act(async()=>button('确认合并').click());expect(calls.replace).toHaveBeenCalledWith(`/dashboard/students/${source}`);
});
