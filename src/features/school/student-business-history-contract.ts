export const BUSINESS_HISTORY_KINDS = ['renewal','activity','assessment','enrollment','communication'] as const;
export type BusinessHistoryKind = typeof BUSINESS_HISTORY_KINDS[number];
export interface BusinessRecordSource {
  record_state?: 'current' | 'historical';
  id: string; student_id: string | null; lead_id?: string | null; source_record_id: string; source_field_ids: string[];
}
export function businessSubjectKey(row: Pick<BusinessRecordSource,'student_id'|'lead_id'|'source_record_id'>):string {
  return row.student_id ?? row.lead_id ?? row.source_record_id;
}
export interface HistoricalRenewal extends BusinessRecordSource {
  period_year: number | null; period_key: string; decision_note: string; outcome: string;
  period_label?: string;
  class_label: string; teacher_label: string;
}
export interface HistoricalActivity extends BusinessRecordSource {
  activity_id: string; activity_name: string; activity_kind: string; registered_on: string | null; occurred_on: string | null;
  participation_status: string; reported_result: string; result_link_status: string;
  result_source_record_id: string | null; result_field_ids: string[];
}
export interface HistoricalAssessment extends BusinessRecordSource {
  history_revision?: number;
  activity_registration_id: string; assessed_on: string | null; assessment_band: string;
  score: number | null; learning_notes: string; parent_notes: string;
}
export interface HistoricalEnrollment extends BusinessRecordSource {
  course_enrollment_id: string; registered_on: string | null; period_label: string; amount: number | null; amount_original: string;
  class_label: string; teacher_label: string; room_label: string; schedule_label: string;
  note?: string;
}
export interface HistoricalCommunication extends BusinessRecordSource {
  occurred_on: string | null; context_kind: string | null; content: string; author_label: string | null;
}
export interface StudentBusinessHistory {
  renewals: HistoricalRenewal[];
  activities: HistoricalActivity[];
  assessments: HistoricalAssessment[];
  enrollments: HistoricalEnrollment[];
  communications: HistoricalCommunication[];
  students: Record<string, string>;
  subjects: Record<string, {name: string; phone: string; grade: number | null}>;
  sources: Record<string, { filename: string; tableName: string; cells: { fieldId: string; fieldName: string; text: string }[] }>;
}
export function businessHistoryKind(value?: string): BusinessHistoryKind | undefined {
  return BUSINESS_HISTORY_KINDS.includes(value as BusinessHistoryKind) ? value as BusinessHistoryKind : undefined;
}
