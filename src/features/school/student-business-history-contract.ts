import type { Database } from '@/lib/database.types';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export const BUSINESS_HISTORY_KINDS = ['renewal','activity','assessment','enrollment','communication'] as const;
export type BusinessHistoryKind = typeof BUSINESS_HISTORY_KINDS[number];
export interface StudentBusinessHistory {
  renewals: Row<'student_renewal_history'>[];
  activities: Row<'student_activity_history'>[];
  assessments: Row<'student_assessment_history'>[];
  enrollments: Row<'student_enrollment_history'>[];
  communications: Row<'student_communication_history'>[];
  students: Record<string, string>;
  sources: Record<string, { filename: string; tableName: string; cells: { fieldId: string; fieldName: string; text: string }[] }>;
}
export function businessHistoryKind(value?: string): BusinessHistoryKind | undefined {
  return BUSINESS_HISTORY_KINDS.includes(value as BusinessHistoryKind) ? value as BusinessHistoryKind : undefined;
}
