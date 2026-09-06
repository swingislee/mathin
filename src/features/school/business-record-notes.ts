import type { BusinessRecordSource, HistoricalAssessment, HistoricalCommunication, StudentBusinessHistory } from './student-business-history-contract';

/** 同一业务反馈合并重复行，保留首次出现的原文；原始来源继续用于核对。 */
export function uniqueBusinessFeedback(...values: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    for (const line of (value ?? '').replace(/\r\n?/g, '\n').split('\n')) {
      const text = line.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      lines.push(text);
    }
  }
  return lines.join('\n');
}

/** 仅同一学生、同一来源且原字段相交的沟通属于该业务事实。 */
export function relatedBusinessCommunications(data: StudentBusinessHistory, record: BusinessRecordSource, context: string): HistoricalCommunication[] {
  return data.communications.filter(row => row.context_kind === context
    && row.student_id === record.student_id && row.source_record_id === record.source_record_id
    && row.source_field_ids.some(field => record.source_field_ids.includes(field)));
}

export function historicalAssessmentFeedback(record: HistoricalAssessment, data?: StudentBusinessHistory): string {
  return uniqueBusinessFeedback(record.learning_notes, record.parent_notes,
    ...(data ? relatedBusinessCommunications(data, record, 'assessment').map(row => row.content) : []));
}

export function hasBusinessFeedbackOwner(data: StudentBusinessHistory, communication: HistoricalCommunication): boolean {
  const records = communication.context_kind === 'assessment' ? data.assessments
    : communication.context_kind === 'renewal' ? data.renewals : [];
  return records.some(record => relatedBusinessCommunications(data, record, communication.context_kind ?? '').some(row => row.id === communication.id));
}
