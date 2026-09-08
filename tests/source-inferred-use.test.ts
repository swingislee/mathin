// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SourceUseButton } from '../src/features/school/SourceUseButton';
const actions=vi.hoisted(()=>({load:vi.fn(),confirm:vi.fn(),push:vi.fn(),refresh:vi.fn()}));
vi.mock('@/features/school/actions/source-use',()=>({getSourceUseContextAction:actions.load,confirmSourceUseAction:actions.confirm}));
vi.mock('@/i18n/navigation',()=>({useRouter:()=>({push:actions.push,refresh:actions.refresh})}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:{open:boolean;children:ReactNode})=>open?children:null,
  DialogContent:({children}:{children:ReactNode})=>createElement('div',{},children),DialogDescription:({children}:{children:ReactNode})=>children,
  DialogFooter:({children}:{children:ReactNode})=>children,DialogHeader:({children}:{children:ReactNode})=>children,DialogTitle:({children}:{children:ReactNode})=>children}));
const studentId='00000000-0000-4000-8000-000000000001';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.clearAllMocks();
 actions.load.mockResolvedValue({ok:true,data:{recordId:'source',name:'示例资料',title:'测评',source:'base',studentId,version:1,canConfirm:true,matchState:'inferred',cells:[],students:[{id:studentId,name:'示例学生',grade:1,phone:''}]}});
 actions.confirm.mockResolvedValue({ok:true,data:2});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
describe('inferred sources can be used before manual review',()=>{
 it('continues directly with an already saved inferred association',async()=>{
  await act(async()=>root.render(createElement(SourceUseButton,{recordId:'source',studentId,locale:'zh',linked:true})));
  await act(async()=>container.querySelector('button')!.click());
  expect(actions.push).toHaveBeenCalledWith(expect.stringContaining(`/${studentId}?tab=followups`));
  expect(actions.load).not.toHaveBeenCalled();expect(actions.confirm).not.toHaveBeenCalled();
 });
 it('opens optional correction without treating an existing association as a navigation shortcut',async()=>{
  await act(async()=>root.render(createElement(SourceUseButton,{recordId:'source',studentId,locale:'zh',linked:true,review:true,context:'assessment',label:'核对／修改'})));
  await act(async()=>container.querySelector('button')!.click());
  expect(actions.load).toHaveBeenCalled();expect(actions.push).not.toHaveBeenCalled();
  expect(container.textContent).toContain('示例资料');expect(container.querySelector('input')).not.toBeNull();
  const confirm=[...container.querySelectorAll('button')].find(button=>button.textContent==='确认并继续')!;
  await act(async()=>confirm.click());
  expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({recordId:'source',studentId,version:1,context:'assessment'}));
  expect(actions.refresh).toHaveBeenCalled();
 });
});
