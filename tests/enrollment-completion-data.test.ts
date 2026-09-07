import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ board: {} as Record<string, unknown>, entries: [] as Record<string, unknown>[], requestedMemberships: [] as string[], error: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc: async (name: string) => ({ data: name === 'get_enrollment_placement_board' ? db.board : [], error: null }),
  from: () => {
    let values = db.entries;
    const query = {
      select: () => query,
      in: (field: string, ids: string[]) => { db.requestedMemberships.push(...ids); values = values.filter(row => ids.includes(row[field] as string)); return query; },
      order: () => query,
      range: async (start: number, end: number) => ({ data: values.slice(start, end + 1), error: db.error ? { message: 'read failed' } : null }),
    };
    return query;
  },
}) }));
import { loadEnrollmentPlacementBoard } from '@/features/school/enrollment-workflow-data';

const id = (value: number) => `f4000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

describe('class roster renewal facts', () => {
  beforeEach(() => {
    db.requestedMemberships = []; db.error = false;
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
});
