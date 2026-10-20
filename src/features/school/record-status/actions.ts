'use server';

import { z } from 'zod';
import { actionError, type ActionResult } from '@/lib/action-result';
import { authorizedClient } from '../actions/guards';
import { COMMON_CODES, parse, uuid } from '../actions/schemas';
import { studentStageRpc } from '../student-stage-data';
import { statusEvidenceSchema, type StatusEvidence } from './contract';

const subjectSchema = z.object({ studentId: uuid.nullable(), leadId: uuid.nullable() })
  .refine(subject => subject.studentId || subject.leadId);

export async function getRecordStatusEvidenceAction(
  subject: { studentId: string | null; leadId: string | null },
): Promise<ActionResult<StatusEvidence[]>> {
  try {
    const value = parse(subjectSchema, subject);
    const { supabase } = await authorizedClient('followup.view');
    // RPC independently checks staff, subject scope and student/lead consistency.
    const data = await studentStageRpc(supabase, 'school_record_status_evidence', {
      p_student_id: value.studentId, p_lead_id: value.leadId,
    });
    return { ok: true, data: z.array(statusEvidenceSchema).parse(data) };
  } catch (error) {
    return actionError<StatusEvidence[]>(error, [...COMMON_CODES, 'FORBIDDEN_SCOPE', 'SUBJECT_MISMATCH']);
  }
}
