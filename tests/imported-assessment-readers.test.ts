import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTeacherAssessmentWorkbenchData } from '@/features/school/teacher-assessment-data';
import { assessmentWorkflowFromDb } from '@/features/school/assessment-workflow-contract';
import { activityEnrollmentContextSchema } from '@/features/school/enrollment-workflow-contract';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: state.rpc }) }));
const importedId = 'abcdef01-2345-abcd-cdef-0123456789ab';
const id = '00000000-0000-4000-8000-000000000001';
const at = '2026-09-07T00:00:00Z';
beforeEach(() => { state.rpc.mockReset(); });

describe('imported assessment reading boundaries', () => {
  it('opens a dated source assessment without inventing a scheduled time', async () => {
    state.rpc.mockResolvedValue({ error: null, data: {
      registrationId: importedId, subjectName: '来源学生', grade: null, gradeText: '', background: '', participationStatus: 'booked',
      scheduledAt: null, location: '', startedAt: null, completedAt: null, score: null, assessmentBand: null,
      teacherObservation: '', paperVersion: null, questions: [], paperOptions: [],
    } });
    expect(await getTeacherAssessmentWorkbenchData(importedId)).toMatchObject({ registrationId: importedId, scheduledAt: '' });
  });
  it('reads a workflow created for an existing imported registration', () => {
    expect(assessmentWorkflowFromDb({ id, registration_id: importedId, stage: 'pending', revision: 1, arrived_at: null,
      report_id: null, sent_report_id: null, sent_at: null, sent_by: null, classification: null, parent_response: '', reasons: [],
      next_contact_at: null, finalized_at: null, revision_reason: '', updated_by: id, updated_at: at,
    }).registrationId).toBe(importedId);
  });
  it('preserves source IDs in the assessment to enrollment handoff', () => {
    expect(activityEnrollmentContextSchema.parse({ registrationId: importedId, studentId: null, leadId: importedId, name: '来源学生',
      phone: '', grade: null, gradeText: '', ownerId: null, leadStatus: 'unassigned', activityId: importedId, activityTitle: '',
      activityAt: '', eligible: false, recommendation: '', assessmentBand: null, route: null, routeNote: '', enrollmentId: null,
      courseTitle: null, termName: null, classroomName: null, termId: null, canContact: false, canEnroll: false, contacts: [],
    })).toMatchObject({ registrationId: importedId, leadId: importedId, activityId: importedId });
  });
});
