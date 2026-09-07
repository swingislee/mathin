import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { readDashboardArchive, evaluateDashboardRange } from './lib/feishu-dashboard-audit.mjs';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

/** 只输出老师、年级和聚合人数；源记录身份及联系方式留在 Base 中。 */
export function buildSeptemberTargetSource(file) {
  const archive = readDashboardArchive(file);
  const dashboard = archive.dashboards.find(item => item.name === '选拔到访仪表盘-9月');
  if (!dashboard) throw new Error('SEPTEMBER_DASHBOARD_REQUIRED');
  const metric = name => {
    const range = dashboard.charts.find(item => item.name === name)?.ranges[0];
    const indicators = range?.multiIndicatorConditions?.indicators;
    const current = indicators?.find(item => item.extra.indicatorName === 'cur')?.dataConditions[0];
    const target = indicators?.find(item => item.extra.indicatorName === 'target')?.dataConditions[0].extraConfig.progress.value;
    if (!current || !Number.isInteger(target)) throw new Error('SOURCE_TARGET_MISSING');
    return { ...evaluateDashboardRange(archive, range, current), target };
  };
  const enrollment = metric('9月报名目标进度'), arrival = metric('9月到访目标'), invitation = metric('9月诺访目标');
  const table = archive.tables.get(enrollment.tableId);
  const fields = table.table.fieldMap;
  const field = name => {
    const entry = Object.entries(fields).find(([, value]) => value.name === name);
    if (!entry) throw new Error('SOURCE_FIELD_MISSING');
    return entry;
  };
  const [teacherId] = field('学科老师'), [gradeId, gradeField] = field('年级/25级'), [dateId] = field('报名日期');
  const autumn = archive.tables.get('tblAHWrD6LItmWMk');
  const options = name => Object.values(autumn.table.fieldMap).find(item => item.name === name).property.options.map(item => item.name).filter(Boolean);
  const teachers = options('授课学科老师'), grades = options('年级'), cells = [];
  for (const id of enrollment.recordIds) {
    const row = table.recordMap[id], users = row[teacherId]?.value?.users ?? [];
    if (users.length > 1) throw new Error('MULTIPLE_SOURCE_TEACHERS');
    const teacher = users[0]?.name ?? '';
    const grade = gradeField.property.options.find(item => item.id === row[gradeId]?.value)?.name;
    if (!grade || (users.length && !teacher)) throw new Error('SOURCE_LABEL_MISSING');
    if (teacher && !teachers.includes(teacher)) teachers.push(teacher);
    if (!grades.includes(grade)) grades.push(grade);
    let cell = cells.find(item => item.teacher === teacher && item.grade === grade);
    if (!cell) { cell = { teacher, grade, actual: 0, undated: 0 }; cells.push(cell); }
    cell.actual += 1;
    if (row[dateId]?.value == null) cell.undated += 1;
  }
  return {
    label: dashboard.name, capturedOn: '2026-09-07', sha256: archive.sha256,
    teachers, grades, cells,
    enrollments: enrollment.count, enrollmentTarget: enrollment.target,
    arrivals: arrival.count, arrivalTarget: arrival.target,
    invitations: invitation.count, invitationTarget: invitation.target,
    missingDate: cells.reduce((sum, cell) => sum + cell.undated, 0),
    unassignedTeacher: cells.filter(cell => !cell.teacher).reduce((sum, cell) => sum + cell.actual, 0),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file || !/2026-09-07/u.test(path.basename(file))) throw new Error('DATED_SEPTEMBER_BASE_REQUIRED');
  const source = buildSeptemberTargetSource(file);
  console.log(JSON.stringify({ month: '2026-09', ...source }));
  if (!process.argv.includes('--apply')) return;
  const directory = '.tmp/principal-dashboard-v1';
  fs.mkdirSync(directory, { recursive: true });
  const { observed } = openHistoryLocalTarget({ attestationPath: `${directory}/target.json`, refresh: true, errorFile: `${directory}/database-error.txt` });
  console.log(JSON.stringify({ ...observed, ssh: false }));
  const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/u).flatMap(line => {
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*["']?([^\r\n"']*)/u.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
  const client = createClient(observed.supabaseOrigin, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword(loadFixedAccount('admin'));
  if (signed.error) throw new Error('FIXED_ADMIN_LOGIN_FAILED');
  try {
    const { data: existing, error: readError } = await client.from('school_monthly_targets').select('revision').eq('month', '2026-09-01').maybeSingle();
    if (readError) throw new Error('TARGET_READ_FAILED');
    if (existing) throw new Error('TARGET_ALREADY_EXISTS: existing goals preserved');
    const { data, error } = await client.rpc('initialize_school_monthly_targets', { p_month: '2026-09-01', p_source: source });
    if (error) throw new Error(`TARGET_INITIALIZATION_FAILED: ${error.message}`);
    fs.writeFileSync(`${directory}/source-summary.json`, JSON.stringify(source, null, 2), 'utf8');
    console.log(JSON.stringify({ imported: true, month: data.month, revision: data.revision, target: data.enrollment_target, sourceEnrollments: source.enrollments }));
  } finally { await client.auth.signOut({ scope: 'local' }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
