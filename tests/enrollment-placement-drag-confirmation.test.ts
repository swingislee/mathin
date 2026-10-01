// @vitest-environment jsdom
import { act,createElement,type ComponentProps,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach,expect,it,vi } from 'vitest';
import messages from '../messages/zh.json';
import { EnrollmentPlacementWorkbench } from '@/features/school/EnrollmentPlacementWorkbench';
import type { EnrollmentPlacementBoard } from '@/features/school/enrollment-workflow-contract';
const calls=vi.hoisted(()=>({move:vi.fn(),change:vi.fn(),preview:vi.fn(),open:vi.fn()}));
vi.mock('@/features/school/enrollment-workflow-actions',()=>({moveEnrollmentSeatAction:calls.move}));
vi.mock('@/features/school/enrollment-placement-change-actions',()=>({changeEnrollmentPlacementAction:calls.change,previewEnrollmentSessionTransferAction:calls.preview}));
vi.mock('@/features/school/SchoolSupportInlineEntry',()=>({SchoolSupportSeatEntry:({classroomId,seat}:{classroomId:string;seat:number})=>createElement('div',{'data-test-seat-entry':`${classroomId}:${seat}`})}));
vi.mock('@/features/school/SchoolSupportPendingRows',()=>({SchoolSupportPendingRows:()=>null}));
vi.mock('@/features/school/SourceEnrollmentPlacementDialog',()=>({SourceEnrollmentPlacementDialog:()=>null}));
vi.mock('@/features/school/Student360Sheet',()=>({Student360Trigger:({children,className}:{children:ReactNode;className?:string})=>createElement('button',{type:'button',className,onClick:(event:{stopPropagation():void})=>{event.stopPropagation();calls.open();}},children)}));
vi.mock('@/i18n/navigation',()=>({Link:({children,...props}:ComponentProps<'a'>)=>createElement('a',props,children),useRouter:()=>({refresh:vi.fn()}),usePathname:()=>'/dashboard/followups/enrollments'}));
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const board:EnrollmentPlacementBoard={options:{courses:[{id:id(1),title:'数学',productCode:null,grade:3,classType:'G+'}],terms:[{id:id(2),name:'秋季',isCurrent:true,startsOn:null,endsOn:null}],classrooms:[3,4].map(n=>({id:id(n),name:n===3?'原班':'目标班',courseId:id(1),termId:id(2),capacity:3,activeCount:n===3?1:0,teacherNames:'教师',sessions:[],operationalStatus:'active'}))},enrollments:[],members:[{membershipId:id(5),studentId:id(6),name:'小林',phone:'',classroomId:id(3),enrollmentId:null,note:'',recommendation:'',seat:1,status:'active'}]};
let cleanup=async()=>{};
afterEach(async()=>{await cleanup();localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});
it.each([[false,null,"grade"],[true,null,"grade"],[false,3,"grade"],[false,4,"grade"],[true,4,"grade"],[true,null,"teacher"]] as const)('opens the transfer choice after dragging (mismatch: %s, taught class: %s, grouping: %s) and waits for confirmation',async(mismatched,taughtClass,group)=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.stubGlobal('crypto',{getRandomValues:globalThis.crypto.getRandomValues.bind(globalThis.crypto)});
  HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.releasePointerCapture=vi.fn();HTMLElement.prototype.hasPointerCapture=()=>true;
  HTMLElement.prototype.scrollBy=vi.fn();
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  const testBoard:EnrollmentPlacementBoard=mismatched?{...board,options:{...board.options,courses:[...board.options.courses,{...board.options.courses[0],id:id(9),title:'进阶数学',grade:4}],classrooms:board.options.classrooms.map(c=>c.id===id(4)?{...c,courseId:id(9)}:c)}}:board;
  const access=taughtClass?{canManageEnrollments:false,teacherClassroomIds:[id(taughtClass)],managedClassroomIds:[]}:undefined;
  const child=createElement(EnrollmentPlacementWorkbench,{initialBoard:{...testBoard,access},canCreateClass:false,now:Date.now(),workspaceQuery:{group}});
  const props={locale:'zh',messages,timeZone:'Asia/Shanghai',children:child};
  await act(async()=>root.render(createElement(NextIntlClientProvider,props)));
  const source=element.querySelector<HTMLElement>(`[data-placement-student="${id(5)}"]`)!;
  const destination=element.querySelector<HTMLElement>(`[data-placement-target="${id(4)}:1"]`)!;
  document.elementFromPoint=()=>destination;
  const name=source.querySelector<HTMLButtonElement>('button')!;
  await act(async()=>name.focus());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  expect(name.className).toContain('pointer-events-none');
  await act(async()=>source.click());
  expect(calls.open).toHaveBeenCalledOnce();
  calls.open.mockClear();
  const send=async(type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:100});Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true}});await act(async()=>source.dispatchEvent(event));};
  await send('pointerdown',20);
  expect(HTMLElement.prototype.setPointerCapture).toHaveBeenLastCalledWith(1);
  expect(vi.mocked(HTMLElement.prototype.setPointerCapture).mock.instances.at(-1)).toBe(source);
  await send('pointermove',160);
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(destination.matches('[data-placement-drop-state="allowed"]')).toBe(true);
  expect(document.querySelector('[data-placement-drag-preview]')?.textContent).toContain('小林 → 目标班');
  expect(document.querySelector('[data-placement-drag-preview]')?.textContent).toContain(mismatched?'班级不匹配，松开后核对并确认插班。':'松开后选择完全调班或临时调班');
  document.elementFromPoint=()=>element.querySelector<HTMLElement>(`[data-placement-classroom="${id(3)}"] td`)!;
  await send('pointermove',170);
  expect(document.querySelector('[data-placement-drag-preview]')?.textContent).toContain('小林 → 原班');
  expect(document.querySelector('[data-placement-drag-preview]')?.textContent).toContain(taughtClass===4?messages.school.enrollmentWorkflow.errorPermission:'已在此班级');
  document.elementFromPoint=()=>destination.closest('[data-placement-classroom]')!.querySelector<HTMLElement>('td')!;
  await send('pointermove',180);await send('pointerup',180);
  expect(document.querySelector('[data-placement-drag-preview]')).toBeNull();
  expect(document.querySelector('[data-placement-drop-state]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(mismatched?'班级不匹配，请确认插班':'确认调班');
  expect(document.querySelector<HTMLInputElement>('input[value="permanent"]')?.checked).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('号位');
  expect(document.querySelector<HTMLInputElement>('input[value="temporary"]')).not.toBeNull();
  expect(calls.move).not.toHaveBeenCalled();expect(calls.change).not.toHaveBeenCalled();
  expect(element.querySelector(`[data-placement-classroom="${id(3)}"] [data-placement-student="${id(5)}"]`)).not.toBeNull();
});

it('blocks dragging between unrelated classes and keeps commercial withdrawal hidden for a teacher',async()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  calls.move.mockClear();calls.change.mockClear();
  HTMLElement.prototype.setPointerCapture=vi.fn();HTMLElement.prototype.releasePointerCapture=vi.fn();HTMLElement.prototype.hasPointerCapture=()=>true;
  HTMLElement.prototype.scrollBy=vi.fn();
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  cleanup=async()=>{await act(async()=>root.unmount());element.remove();};
  const initialBoard={...board,access:{canManageEnrollments:false,teacherClassroomIds:[id(9)],managedClassroomIds:[]}};
  const child=createElement(EnrollmentPlacementWorkbench,{initialBoard,canCreateClass:false,now:Date.now()});
  const props={locale:'zh',messages,timeZone:'Asia/Shanghai',children:child};
  await act(async()=>root.render(createElement(NextIntlClientProvider,props)));
  const source=element.querySelector<HTMLElement>(`[data-placement-student="${id(5)}"]`)!;
  const destination=element.querySelector<HTMLElement>(`[data-placement-target="${id(4)}:1"]`)!;
  document.elementFromPoint=()=>destination;
  const send=async(type:string,x:number)=>{const event=new MouseEvent(type,{bubbles:true,button:0,clientX:x,clientY:100});Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true}});await act(async()=>source.dispatchEvent(event));};
  await send('pointerdown',20);await send('pointermove',160);
  expect(destination.matches('[data-placement-drop-state="blocked"]')).toBe(true);
  expect([...element.querySelectorAll('button')].some(button=>button.textContent==='退课')).toBe(false);
  await send('pointerup',160);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls.move).not.toHaveBeenCalled();expect(calls.change).not.toHaveBeenCalled();
});

async function mountRoster(canTeach = false, canAdd = false, group: "grade" | "teacher" = "grade") {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  calls.move.mockClear(); calls.change.mockClear();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  cleanup = async () => { await act(async () => root.unmount()); element.remove(); };
  const initialBoard = { ...board, options: { ...board.options, classrooms: board.options.classrooms.map(row => ({ ...row,
    location: { campusId: id(70), campusName: '东校区', roomName: '305' },
  })) } };
  const children = createElement(EnrollmentPlacementWorkbench, { initialBoard, canCreateClass: false, workspace: 'classes', canTeach, canAdd, workspaceQuery: { group } });
  const props = { locale: 'zh', messages, timeZone: 'Asia/Shanghai', children };
  await act(async () => root.render(createElement(NextIntlClientProvider, props)));
  return element;
}

it('opens the roster independently of lessons and keeps class information accessible', async () => {
  const element = await mountRoster(true);
  const row = element.querySelector<HTMLElement>(`[data-placement-classroom="${id(3)}"]`)!;
  const roster = row.querySelector<HTMLButtonElement>('[data-class-roster-toggle]')!;
  const lessons = [...row.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith('课次'))!;
  await act(async () => roster.click());
  expect(row.dataset.mobileRosterOpen).toBe('true');
  expect(roster.getAttribute('aria-expanded')).toBe('true');
  await act(async () => lessons.click());
  expect(row.getAttribute('aria-expanded')).toBe('true');
  await act(async () => roster.click());
  expect(row.dataset.mobileRosterOpen).toBe('false');
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(element.querySelectorAll(`[data-placement-student="${id(5)}"]`)).toHaveLength(1);
  const location = row.querySelector<HTMLButtonElement>('[data-class-info]')!;
  expect(location.textContent).toContain('东校区');
  expect(location.textContent).not.toContain('305');
  await act(async () => location.click());
  const info = document.querySelector('[role="dialog"]')!;
  expect(info.textContent).toContain('原班'); expect(info.textContent).toContain('数学'); expect(info.textContent).toContain('教师');
  expect(info.textContent).toContain('校区 东校区'); expect(info.textContent).toContain('教室 305');
  expect(info.querySelector('a')?.getAttribute('href')).toBe(`/dashboard/classes/${id(3)}`);
  expect(calls.move).not.toHaveBeenCalled(); expect(calls.change).not.toHaveBeenCalled();
});

it('opens the first real vacancy by tapping its visible plus, and preserves add permissions', async () => {
  const element = await mountRoster(false, true);
  const row = element.querySelector<HTMLElement>(`[data-placement-classroom="${id(3)}"]`)!;
  await act(async () => row.querySelector<HTMLButtonElement>('[data-class-roster-toggle]')!.click());
  const vacancy = row.querySelector<HTMLButtonElement>('[data-placement-vacancy]')!;
  const plus = vacancy.querySelector<SVGElement>('[data-placement-vacancy-icon]')!;
  expect(vacancy.disabled).toBe(false);
  expect(vacancy.textContent).toContain('空 2 位');
  await act(async () => plus.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(element.querySelector('[data-test-seat-entry]')?.getAttribute('data-test-seat-entry')).toBe(`${id(3)}:2`);
  expect(calls.move).not.toHaveBeenCalled(); expect(calls.change).not.toHaveBeenCalled();
  await cleanup();
  const restricted = await mountRoster();
  const disabled = restricted.querySelector<HTMLButtonElement>('[data-placement-vacancy]')!;
  expect(disabled.disabled).toBe(true);
  expect(disabled.querySelector('[data-placement-vacancy-icon]')).toBeNull();
  await act(async () => disabled.click());
  expect(restricted.querySelector('[data-test-seat-entry]')).toBeNull();
});

it('lets touch scroll through names and uses select-then-seat for a reviewed transfer', async () => {
  const element = await mountRoster();
  const source = element.querySelector<HTMLElement>(`[data-placement-student="${id(5)}"]`)!;
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 20, clientY: type === 'pointerdown' ? 30 : 160 });
    Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: 'touch' } });
    await act(async () => source.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
  }
  expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();
  expect(document.querySelector('[data-placement-drag-preview]')).toBeNull();
  await act(async () => source.querySelector<HTMLButtonElement>('[data-placement-select]')!.click());
  const target = element.querySelector<HTMLElement>(`[data-placement-classroom="${id(4)}"]`)!;
  await act(async () => target.querySelector<HTMLButtonElement>('[data-class-roster-toggle]')!.click());
  const seat = target.querySelector<HTMLButtonElement>(`[data-placement-target="${id(4)}:1"] button`)!;
  expect(seat.disabled).toBe(false);
  await act(async () => seat.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('确认调班');
  expect(calls.move).not.toHaveBeenCalled(); expect(calls.change).not.toHaveBeenCalled();
  expect(source.closest('[data-placement-classroom]')?.getAttribute('data-placement-classroom')).toBe(id(3));
});

it('reveals the matching empty pending grade in the teacher footer when returning a selected student', async () => {
  const element = await mountRoster(false, false, 'teacher');
  expect(element.querySelector('[data-placement-pending]')).toBeNull();
  const source = element.querySelector<HTMLElement>(`[data-placement-student="${id(5)}"]`)!;
  await act(async () => source.querySelector<HTMLButtonElement>('[data-placement-select]')!.click());
  const pendingRow = element.querySelector<HTMLElement>(`[data-placement-pending="${id(2)}:3"]`)!;
  expect(pendingRow).not.toBeNull();
  expect(element.querySelectorAll('[data-placement-pending]')).toHaveLength(1);
  expect(pendingRow.textContent).toContain('3 年级');
  calls.move.mockResolvedValueOnce({ ok: false, code: 'PERMISSION' });
  await act(async () => pendingRow.querySelector<HTMLButtonElement>('button')!.click());
  expect(calls.move).toHaveBeenCalledWith(expect.objectContaining({ membershipId: id(5), fromClassroomId: id(3), toClassroomId: null, seat: null, expectedSeat: 1 }));
});
