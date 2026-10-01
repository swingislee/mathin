import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ board: {} as Record<string, unknown>, entries: [] as Record<string, unknown>[], locations: [] as Record<string, unknown>[],
  requestedMemberships: [] as string[], requestedClassrooms: [] as string[], error: false, locationError: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc: async (name: string) => ({ data: name === 'get_enrollment_placement_board' ? db.board : [], error: null }),
  from: (table: string) => {
    let values = table === 'classrooms' ? db.locations : db.entries;
    const query = {
      select: () => query,
      in: (field: string, ids: string[]) => { (table === 'classrooms' ? db.requestedClassrooms : db.requestedMemberships).push(...ids); values = values.filter(row => ids.includes(row[field] as string)); return query; },
      order: () => query,
      range: async (start: number, end: number) => ({ data: values.slice(start, end + 1), error: (table === 'classrooms' ? db.locationError : db.error) ? { message: 'read failed' } : null }),
    };
    return query;
  },
}) }));
import { loadEnrollmentPlacementBoard } from '@/features/school/enrollment-workflow-data';

const id = (value: number) => `f4000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('class roster renewal facts', () => {
  beforeEach(() => {
    db.requestedMemberships = []; db.requestedClassrooms = []; db.locations = []; db.error = false; db.locationError = false;
    db.board = { options: { courses: [], terms: [], classrooms: [] },
      members: [1, 2, 3].map(value => ({ membershipId: id(value), studentId: id(value + 10), name: '学生', phone: '', classroomId: id(20), enrollmentId: null, note: '', recommendation: '' })),
      enrollments: [1, 2].map(value => ({ id: id(value + 30), opportunityId: id(value + 40), studentId: id(value + 10), studentName: '学生', studentPhone: '', courseId: id(50), courseTitle: '', termId: id(60), termName: '',
        status: value === 1 ? 'active' : 'cancelled', note: '', confirmedAt: '', confirmedByName: '', cancelledAt: null, cancelledByName: null, assignmentId: null, classroomId: null, classroomName: null, membershipId: null,
        assignedAt: null, claimableClassroomIds: [], updatedAt: '' })),
    };
    db.entries = [1, 2, 3, 4].map(value => ({ source_class_membership_id: id(value), opportunity_id: id(value + 40) }));
  });

  it('requires an active enrollment linked to the original membership, not merely an opportunity', async () => {
    db.entries.push({ source_class_membership_id: id(1), opportunity_id: id(41) });
    const board = await loadEnrollmentPlacementBoard();
    expect(board.renewedMembershipIds).toEqual([id(1)]);
    expect(db.requestedMemberships).toEqual([id(1), id(2), id(3)]);
    expect(board.members).toHaveLength(3);
  });

  it('surfaces a failed renewal read instead of treating it as a negative result', async () => {
    db.error = true;
    await expect(loadEnrollmentPlacementBoard()).rejects.toThrow('PLACEMENT_RENEWAL_FIELDS_READ');
  });

  it('keeps teacher placement data scoped to the board instead of requiring management-only enrichment',async()=>{
    db.board.access={canManageEnrollments:false,teacherClassroomIds:[id(20)],managedClassroomIds:[]};
    db.error=true;
    const board=await loadEnrollmentPlacementBoard();
    expect(board.access?.teacherClassroomIds).toEqual([id(20)]);
    expect(board.sessionTransfers).toEqual([]);
    expect(db.requestedMemberships).toEqual([]);
  });

  const withClasses = () => {
    (db.board.options as { classrooms: unknown[] }).classrooms = [20, 21].map(value => ({ id: id(value), name: '班级名称含其他校区', courseId: id(50), termId: id(60),
      capacity: 16, activeCount: 0, operationalStatus: 'active', teacherNames: '任课老师', sessions: [] }));
    db.locations = [
      { id: id(20), room: '旧教室', default_room: { name: '305', campus_id: id(70), campuses: { name: '东校区' } } },
      { id: id(21), room: '', default_room: null },
      { id: id(22), room: '不可见教室', default_room: { name: '106', campus_id: id(71), campuses: { name: '其他校区' } } },
    ];
  };

  it.each([true, false])('reads canonical locations only for board classes (management: %s)', async canManageEnrollments => {
    withClasses();
    db.board.access = { canManageEnrollments, teacherClassroomIds: [id(20)], managedClassroomIds: canManageEnrollments ? [id(20), id(21)] : [] };
    const board = await loadEnrollmentPlacementBoard();
    expect(db.requestedClassrooms).toEqual([id(20), id(21)]);
    expect(board.options.classrooms.map(row => row.location)).toEqual([
      { campusId: id(70), campusName: '东校区', roomName: '305' },
      { campusId: null, campusName: null, roomName: null },
    ]);
    expect(board.locationsFailed).toBe(false);
    if (!canManageEnrollments) expect(db.requestedMemberships).toEqual([]);
  });

  it('keeps the roster available with an explicit location failure rather than treating unknown as unset', async () => {
    withClasses(); db.locationError = true;
    db.board.access = { canManageEnrollments: false, teacherClassroomIds: [id(20)], managedClassroomIds: [] };
    const board = await loadEnrollmentPlacementBoard();
    expect(board.options.classrooms).toHaveLength(2);
    expect(board.locationsFailed).toBe(true);
    expect(board.options.classrooms[0].location).toBeUndefined();
  });
});
