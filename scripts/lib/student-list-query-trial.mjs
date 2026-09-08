import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './history-local-target.mjs';

export const studentListSqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`;

/** 固定本机目标、事务内候选 DDL 与只读断言；成功和异常退出均不留下业务写入。 */
export function runStudentListQueryTrial(statements) {
  const root = '.tmp/student-list-query-check';
  fs.mkdirSync(root, { recursive: true });
  openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.txt` });
  const migration = fs.readFileSync('supabase/migrations/20260908009100_student_list_query.sql', 'utf8')
    .replaceAll('create function ', 'create or replace function ').replaceAll('create collation ', 'create collation if not exists ');
  const plans = fs.readFileSync('supabase/migrations/20260908009200_student_list_parameter_plans.sql', 'utf8');
  const compatibility = fs.readFileSync('supabase/migrations/20260908009300_student_list_field_compatibility.sql', 'utf8').replaceAll('create function ', 'create or replace function ');
  const sql = `begin;set local lock_timeout='3s';set local statement_timeout='45s';${migration}\n${plans}\n${compatibility}\n${statements}\nrollback;`;
  const log = fs.openSync(`${root}/database-log.txt`, 'w');
  try {
    const output = execFileSync('docker.exe', ['--context', 'desktop-linux', 'exec', '-i', 'supabase-db',
      'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 96 * 1024 * 1024, stdio: ['pipe', 'pipe', log] });
    return output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  } catch { throw new Error('STUDENT_LIST_QUERY_CHECK_FAILED: inspect the private database log'); }
  finally { fs.closeSync(log); }
}
