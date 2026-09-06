import type { HistoryArchiveCell } from './history-archive-contract';

export interface ImportedHistoryEntity {
  key: string;
  kind: 'student' | 'lead';
  name: string;
  phones: string[];
  sourceKeys: string[];
}

export interface ImportedHistoryCase {
  key: string;
  label: string;
  kind: 'matched' | 'review' | 'unmatched';
  entityKind: 'student' | 'lead' | null;
  phones: string[];
  recordIds: string[];
}

export interface ImportedHistoryRecord {
  id: string;
  source_data: { filename: string; sha256: string };
  record_data: {
    label: string;
    tableName: string;
    sourceRecordId: string;
    sourceRow: number | null;
    dateLabel: string | null;
    names: string[];
    phones: string[];
    cells: HistoryArchiveCell[];
  };
  match_status: 'matched' | 'review' | 'unmatched';
  entity_data: ImportedHistoryEntity | null;
  candidate_data: ImportedHistoryEntity[];
  student_id: string | null;
  lead_id: string | null;
  search_text: string;
}

export interface ImportedHistoryTrial {
  id: string;
  importedAt: string;
  manifest: {
    schemaVersion: 1;
    mode: 'local_trial';
    workScope: 'history_only';
    cases: ImportedHistoryCase[];
    sourceCount: number;
    tableCount: number;
    recordCount: number;
    linkedIdentities: number;
    reviewCases: number;
    unmatchedCases: number;
  };
  verification: {
    attempts: number;
    insertedRecords: number;
    originalsEqual: boolean;
    currentWorkUnchanged: boolean;
    before: Record<string, number>;
    after: Record<string, number>;
  };
  records: ImportedHistoryRecord[];
}

export function normalizeHistoryTrialSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export function historyTrialHref(q = '', caseKey = ''): string {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (caseKey) query.set('case', caseKey);
  return `/dashboard/history-import/test${query.size ? `?${query}` : ''}`;
}
