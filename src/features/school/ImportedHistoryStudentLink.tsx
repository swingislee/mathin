import { Link } from '@/i18n/navigation';
import { getProfile, requireDashboardEnvironment } from '@/lib/auth';
import { isLocalHistoryArchiveEnvironment } from './history-archive-contract';
import { historyTrialHref } from './history-import-trial-contract';
import { loadImportedHistoryTrial } from './history-import-trial-data';
import { getHistoryImportTrialMessages } from './history-import-trial-messages';

export async function ImportedHistoryStudentLink({ studentId, locale }: { studentId: string; locale: string }) {
  if (!isLocalHistoryArchiveEnvironment(process.env.NODE_ENV, process.env.NEXT_PUBLIC_SUPABASE_URL)) return null;
  const { user } = await requireDashboardEnvironment(locale, ['staff']);
  if ((await getProfile(user.id))?.role !== 'admin') return null;
  const trial = await loadImportedHistoryTrial(locale);
  const records = trial?.records.filter(record => record.student_id === studentId) ?? [];
  const sample = trial?.manifest.cases.find(item => item.recordIds.some(id => records.some(record => record.id === id)));
  if (!sample) return null;
  const m = getHistoryImportTrialMessages(locale);
  return <p className="mt-4 text-sm"><Link href={historyTrialHref('', sample.key)} className="underline underline-offset-4">{m.history} · {records.length}</Link></p>;
}
