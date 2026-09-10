import { beforeEach, expect, it, vi } from 'vitest';
import { changeEnrollmentPlacementAction, previewEnrollmentSessionTransferAction } from '@/features/school/enrollment-placement-change-actions';
import { moveEnrollmentSeatAction } from '@/features/school/enrollment-workflow-actions';
import { canMovePlacement } from '@/features/school/enrollment-workflow-contract';

const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),board:vi.fn(),permission:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/features/school/actions/guards',()=>({staffRpcClient:mocks.auth,authorizedClient:mocks.permission}));
vi.mock('@/features/school/enrollment-workflow-data',()=>({enrollmentWorkflowRpc:mocks.rpc,loadEnrollmentPlacementBoard:mocks.board}));
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={requestId:id(1),mode:'permanent' as const,membershipId:id(2),enrollmentId:null,fromClassroomId:id(3),toClassroomId:id(4),seat:1,expectedSeat:1,reason:'',allowMismatch:false,transferId:null,sessions:[]};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({});
  mocks.rpc.mockImplementation(async(name:string)=>name==='can_access_enrollment_placement'?true:name==='preview_enrollment_session_transfer'?[]:{});
  mocks.board.mockResolvedValue({options:{courses:[],terms:[],classrooms:[]},members:[],enrollments:[]});
});

it('allows the teacher placement capability without requiring global enrollment management',async()=>{
  expect((await changeEnrollmentPlacementAction(input)).ok).toBe(true);
  expect((await previewEnrollmentSessionTransferAction({membershipId:id(2),classroomId:id(4),seat:1})).ok).toBe(true);
  expect((await moveEnrollmentSeatAction({enrollmentId:null,membershipId:id(2),fromClassroomId:id(3),toClassroomId:id(4),seat:1,expectedSeat:1})).ok).toBe(true);
  expect(mocks.permission).not.toHaveBeenCalled();
  expect(mocks.auth).toHaveBeenCalledTimes(3);
});

it('rejects an account without the placement capability before calling the write RPC',async()=>{
  mocks.rpc.mockResolvedValue(false);
  expect(await changeEnrollmentPlacementAction(input)).toEqual({ok:false,code:'FORBIDDEN'});
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.board).not.toHaveBeenCalled();
});

it('returns a database scope rejection without presenting a saved board',async()=>{
  mocks.rpc.mockImplementation(async(name:string)=>{if(name==='can_access_enrollment_placement')return true;throw new Error('FORBIDDEN_SCOPE');});
  expect(await changeEnrollmentPlacementAction(input)).toEqual({ok:false,code:'FORBIDDEN_SCOPE'});
  expect(mocks.board).not.toHaveBeenCalled();
});

it.each([
  {taught:['a'],from:'a',to:'b',allowed:true},
  {taught:['b'],from:'a',to:'b',allowed:true},
  {taught:['a','b'],from:'a',to:'b',allowed:true},
  {taught:['c'],from:'a',to:'b',allowed:false},
  {taught:['b'],from:null,to:'b',allowed:true},
  {taught:['a'],from:'a',to:null,allowed:true},
  {taught:['b'],from:'a',to:'a',allowed:false},
])('reflects the taught endpoint in the placement controls: %j',({taught,from,to,allowed})=>{
  expect(canMovePlacement({canManageEnrollments:false,teacherClassroomIds:taught,managedClassroomIds:[]},from,to)).toBe(allowed);
});

it('keeps both class scopes necessary for a manager who is not a class teacher',()=>{
  const access={canManageEnrollments:true,teacherClassroomIds:[],managedClassroomIds:['a']};
  expect(canMovePlacement(access,'a','b')).toBe(false);
  expect(canMovePlacement({...access,managedClassroomIds:['a','b']},'a','b')).toBe(true);
});
