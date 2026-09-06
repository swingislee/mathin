import 'server-only';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import type { ImportedHistoryRecord, ImportedHistoryTrial } from './history-import-trial-contract';

/** 管理员经同一 Supabase 会话读取已入库资料；页面读取不访问本机预览文件。 */
export async function loadImportedHistoryTrial(locale: string): Promise<ImportedHistoryTrial | null> {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error('HISTORY_TRIAL_LOCAL_ONLY');
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  const profile = await getProfile(user.id);
  if (profile?.role !== 'admin') throw new Error('FORBIDDEN');
  const supabase = await createClient();
  const { data: batch, error } = await supabase.from('history_import_batches')
    .select('id,manifest,verification,imported_at')
    .eq('batch_key', 'history-trial-20260906-v1').maybeSingle();
  if (error) throw new Error(`HISTORY_TRIAL_READ_${error.code}`);
  if (!batch) return null;
  const { data: links, error: linkError } = await supabase.from('history_import_batch_records')
    .select('record_id').eq('batch_id', batch.id).limit(251);
  if (linkError) throw new Error(`HISTORY_TRIAL_LINKS_${linkError.code}`);
  if (!links?.length || links.length > 250) throw new Error('HISTORY_TRIAL_BATCH_SIZE');
  const { data: records, error: recordsError } = await supabase.from('history_import_records')
    .select('id,source_data,record_data,match_status,entity_data,candidate_data,student_id,lead_id,search_text')
    .in('id', links.map(link => link.record_id)).order('id').limit(251);
  if (recordsError) throw new Error(`HISTORY_TRIAL_RECORDS_${recordsError.code}`);
  const manifest = batch.manifest as unknown as ImportedHistoryTrial['manifest'];
  if (manifest.schemaVersion !== 1 || manifest.mode !== 'local_trial' || manifest.workScope !== 'history_only'
    || records?.length !== manifest.recordCount || links.length !== manifest.recordCount) throw new Error('HISTORY_TRIAL_CONTRACT');
  return {
    id: batch.id, importedAt: batch.imported_at, manifest,
    verification: batch.verification as unknown as ImportedHistoryTrial['verification'],
    records: records as unknown as ImportedHistoryRecord[],
  };
}
