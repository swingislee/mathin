import type { ImportedHistoryRecord, ImportedHistoryTrial } from './history-import-trial-contract';

export interface ImportedFamilyHistory {
  importedAt: string;
  manifest: Omit<ImportedHistoryTrial['manifest'], 'mode'> & {
    mode: 'local_family_audit';
    subject: { key: string; studentId: string; name: string; phones: string[] };
    searchedSourceCount: number;
    previousRecordCount: number;
    linkedRecordCount: number;
    candidateRecordCount: number;
    rosterRecordCount: number;
    coverage: {
      recordId: string;
      category: 'linked' | 'candidate' | 'roster_mention';
      hits: { fieldId: string; fieldName: string; text: string }[];
    }[];
  };
  verification: ImportedHistoryTrial['verification'];
  records: ImportedHistoryRecord[];
}

export const originalFieldName = (value: string): string => value.replace(/\s*\[[A-Z]+\]$/, '').trim();

export function originalField(record: ImportedHistoryRecord, name: string): string {
  return record.record_data.cells.find(cell => originalFieldName(cell.fieldName) === name)?.text.trim() ?? '';
}

export function originalEnrollmentPeriods(record: ImportedHistoryRecord): { course: string; date: string; amount: string }[] {
  const cells = record.record_data.cells;
  return cells.flatMap((cell, index) => {
    if (!/^报课\d*$/.test(originalFieldName(cell.fieldName)) || !cell.text.trim()) return [];
    let end = cells.findIndex((next, nextIndex) => nextIndex > index && /^报课\d*$/.test(originalFieldName(next.fieldName)));
    if (end < 0) end = cells.length;
    const period = cells.slice(index + 1, end);
    const value = (field: string) => period.find(next => originalFieldName(next.fieldName) === field)?.text.trim() ?? '';
    return [{ course: cell.text, date: value('报名日期'), amount: value('缴费金额') }];
  });
}
