import 'server-only';
import { cache } from 'react';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment, type HistoryArchiveCell, type HistoryArchiveDetail, type HistoryArchiveEntity,
  type HistoryArchiveFilters, type HistoryArchivePageData, type HistoryArchiveRow, type HistoryArchiveSummary, type HistoryMatchStatus } from './history-archive-contract';
import { normalizeHistoryTrialSearch } from './history-import-trial-contract';

const archiveClient = cache(async () => {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('HISTORY_ARCHIVE_LOCAL_ONLY');
  const { user } = await requireDashboardEnvironment('zh', ['staff']);
  if ((await getProfile(user.id))?.role !== 'admin') throw new Error('FORBIDDEN');
  return createClient();
});

const completeBatch = cache(async (client: Awaited<ReturnType<typeof createClient>>) => {
  const { data, error } = await client.from('history_import_batches').select('id,manifest,imported_at')
    .contains('manifest', { mode: 'complete_source_import' }).order('imported_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('HISTORY_ARCHIVE_BATCH_READ');
  return data;
});

type StoredRecord = {
  id: string; student_id: string | null; source_sha256: string; source_data: { filename: string };
  record_data: { label: string; tableName: string; sourceRecordId: string; sourceRow: number | null; dateLabel: string | null;
    names: string[]; phones: string[]; warnings: string[]; cells: HistoryArchiveCell[] };
  match_status: HistoryMatchStatus; match_data: { reason: string }; entity_data: HistoryArchiveEntity | null; candidate_data: HistoryArchiveEntity[];
  association: { student_id: string; student: { id: string; name: string; grade: number | null; phone: string; parent_phone: string } | null } | null;
};

const recordSelection = '*,association:history_import_associations(student_id,student:students(id,name,grade,phone,parent_phone))' as const;

function hydrate(stored: StoredRecord): HistoryArchiveRow {
  const record = stored.record_data;
  const narrative = record.cells.filter(cell => cell.kind === 'narrative' && cell.text.trim());
  const cells = narrative.length ? narrative : record.cells.filter(cell => cell.kind !== 'system' && cell.text.trim());
  const confirmedStudent = stored.association?.student;
  const entity: HistoryArchiveEntity | null = confirmedStudent ? {
    key: `student:${confirmedStudent.id}`, kind: 'student', name: confirmedStudent.name,
    phones: [...new Set([confirmedStudent.phone, confirmedStudent.parent_phone].filter(Boolean))], grade: confirmedStudent.grade,
    sourceKeys: [], gradeCorrection: null,
  } : stored.association ? null : stored.entity_data;
  return { id: stored.id, label: record.label, sourceName: stored.source_data.filename, tableName: record.tableName,
    sourceRecordId: record.sourceRecordId, sourceRow: record.sourceRow, dateLabel: record.dateLabel, names: record.names, phones: record.phones,
    excerpt: cells.map(cell => `${cell.fieldName}：${cell.text}`).join('\n').slice(0, 260), matchStatus: stored.association ? 'matched' : stored.match_status,
    matchReason: stored.association ? 'confirmed_during_work' : stored.match_data.reason, entity, candidateCount: stored.candidate_data.length, warnings: record.warnings ?? [] };
}

/** 页面从实际入库批次分页查询，不再依赖先前的 SQLite 试导入文件。 */
export async function loadHistoryArchivePage(filters: HistoryArchiveFilters): Promise<HistoryArchivePageData> {
  const client = await archiveClient();
  const batch = await completeBatch(client);
  if (!batch) return { summary: { available:false,generatedAt:null,sourceCount:0,tableCount:0,recordCount:0,contentRecordCount:0,
    matchedCount:0,reviewCount:0,singleCandidateReviewCount:0,multipleCandidateReviewCount:0,unmatchedCount:0,unmatchedWithIdentityCount:0,
    unmatchedWithoutIdentityCount:0,gradeCorrectionCount:0,excludedCommunicationCount:0,archivedClassCount:0,tables:[] }, rows:[],total:0,page:1,pageSize:filters.pageSize };
  const summary = (batch.manifest as unknown as { summary: HistoryArchiveSummary }).summary;
  let query = client.from('history_import_records').select(`${recordSelection},history_import_batch_records!inner(batch_id)`, { count:'exact' })
    .eq('history_import_batch_records.batch_id', batch.id).eq('record_data->>hasContent', 'true');
  if (filters.status === 'matched') query = query.or('match_status.eq.matched,association.not.is.null');
  else if (filters.status !== 'all') query = query.eq('match_status', filters.status).is('association', null);
  if (filters.table) query = query.eq('source_table_id', filters.table);
  for (const token of normalizeHistoryTrialSearch(filters.q).split(' ').filter(Boolean)) query = query.ilike('search_text', `%${token.replace(/[\\%_]/g, '\\$&')}%`);
  const start = (filters.page - 1) * filters.pageSize;
  const { data, error, count } = await query.order('id').range(start, start + filters.pageSize - 1);
  if (error) throw new Error('HISTORY_ARCHIVE_RECORD_READ');
  return { summary, rows: (data as unknown as StoredRecord[]).map(hydrate), total: count ?? 0, page: filters.page, pageSize: filters.pageSize };
}

export async function loadHistoryArchiveDetail(id: string, page = 1): Promise<HistoryArchiveDetail | null> {
  const client = await archiveClient();
  const batch = await completeBatch(client);
  const { data, error } = await client.from('history_import_records').select(recordSelection).eq('id', id).maybeSingle();
  if (error) throw new Error('HISTORY_ARCHIVE_DETAIL_READ');
  if (!data) return null;
  const stored = data as unknown as StoredRecord;
  const relatedPageSize = 10;
  let related: HistoryArchiveRow[] = [], relatedTotal = 0;
  const studentId = stored.association?.student_id ?? stored.student_id;
  if ((studentId || stored.entity_data) && batch) {
    const start = (page - 1) * relatedPageSize;
    let query = client.from('history_import_records').select(`${recordSelection},association_scope:history_import_associations(),history_import_batch_records!inner(batch_id)`, { count:'exact' })
      .eq('history_import_batch_records.batch_id', batch.id).neq('id', id).eq('record_data->>hasContent','true');
    if (studentId) query = query.eq('association_scope.student_id', studentId).or(`student_id.eq.${studentId},association_scope.not.is.null`);
    else query = query.eq('entity_data->>key', stored.entity_data!.key).is('association', null);
    const result = await query.order('id').range(start, start + relatedPageSize - 1);
    if (result.error) throw new Error('HISTORY_ARCHIVE_RELATED_READ');
    related = (result.data as unknown as StoredRecord[]).map(hydrate);
    relatedTotal = result.count ?? 0;
  }
  return { record:hydrate(stored), cells:stored.record_data.cells, candidates:stored.candidate_data, related, relatedTotal,
    relatedPage:page, relatedPageSize, sourceHash:stored.source_sha256 };
}
