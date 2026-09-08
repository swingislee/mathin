import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { textFileSha256 } from './lib/text-hash.mjs';

const mode = process.argv[2];
if (!['--check', '--apply', '--verify'].includes(mode)) throw new Error('Use --check, --apply or --verify');
const root = '.tmp/lead-fact-alignment';
fs.mkdirSync(root, { recursive: true });
const { sql } = openHistoryLocalTarget({ attestationPath: `${root}/preflight.json`, refresh: true, errorFile: `${root}/database-error.txt` });
const version = '20260908110000_lead_business_fact_alignment';
const file = `supabase/migrations/${version}.sql`, migration = fs.readFileSync(file, 'utf8'), checksum = textFileSha256(file);
const quote = value => `'${value.replaceAll("'", "''")}'`;
const applied = sql(`begin read only;select checksum from public.schema_migrations where version=${quote(version)};commit;`);
if (applied && applied !== checksum) throw new Error('MIGRATION_CHECKSUM_CHANGED');

// 预检查只读现有函数，逐段核对迁移合同；不造数据、不做事务演练。
if (!applied) {
  const patches = [...migration.matchAll(/\('([^']+)',\$before\d+\$([\s\S]*?)\$before\d+\$,\$after\d+\$([\s\S]*?)\$after\d+\$\)/g)];
  if (patches.length !== 20) throw new Error('PATCH_COUNT_CHANGED');
  const definitions = new Map();
  for (const [, signature, before, after] of patches) {
    const definition = definitions.get(signature) ?? sql(`begin read only;select pg_get_functiondef(${quote(signature)}::regprocedure);commit;`);
    if (!definition.includes(before)) throw new Error(`LEAD_FACT_CONTRACT_CHANGED: ${signature}`);
    definitions.set(signature, definition.replaceAll(before, after));
  }
  if (mode === '--apply') {
    const statement = `begin;set local lock_timeout='5s';set local statement_timeout='45s';
      select pg_advisory_xact_lock(hashtextextended('lead-business-facts',0));
      ${migration}
      insert into public.schema_migrations(version,checksum) values(${quote(version)},${quote(checksum)});commit;`;
    // 现有读取函数分别由 postgres 与 supabase_admin 拥有，由本机维护角色保留原所有权更新。
    try {
      execFileSync('docker.exe', ['--context','desktop-linux','exec','-i','supabase-db','psql','-X','-qAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],
        { input: statement, encoding: 'utf8', windowsHide: true, stdio: ['pipe','pipe','pipe'], maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      fs.writeFileSync(`${root}/database-error.txt`, String(error.stderr ?? error.message));
      throw new Error('LEAD_FACT_DATABASE_ERROR: inspect private error file');
    }
  } else if (mode === '--verify') throw new Error('MIGRATION_NOT_APPLIED');
}
if (applied || mode !== '--check') {
  const result = JSON.parse(sql(`begin read only;
    select jsonb_build_object(
      'owner',public.student_first_contact_detail(null,'Source staff','unassigned',null)='not_contacted',
      'retry',public.student_first_contact_detail(null,'Source staff','unassigned','unreachable')='unreachable',
      'unassigned',public.student_first_contact_detail(null,'','uncontacted',null)='unassigned',
      'sourceTime',public.lead_source_origin_time('{"cells":[{"fieldName":"提交时间","text":"2025/12/8 15:34"}]}','Asia/Shanghai')::timestamptz='2025-12-08T07:34:00Z'::timestamptz,
      'datePrecision',public.lead_source_origin_time('{"cells":[{"fieldName":"获取日期","text":"2025/12/8"}]}','Asia/Shanghai')='2025-12-08',
      'unknownDate',public.lead_source_origin_time('{"cells":[{"fieldName":"提交日期","text":"12.10"}]}','Asia/Shanghai') is null,
      'invalidDate',public.lead_source_origin_time('{"cells":[{"fieldName":"提交日期","text":"2025/2/30"}]}','Asia/Shanghai') is null,
      'privateHelper',not has_function_privilege('authenticated','public.lead_source_origin_time(jsonb,text)','EXECUTE'),
      'anonymousDenied',not has_function_privilege('anon','public.get_lead_origin_events(uuid[])','EXECUTE')
    );commit;`));
  if (Object.values(result).some(value => value !== true)) throw new Error(`READ_CONTRACT_FAILED: ${JSON.stringify(result)}`);
}
const result = { mode, checksum, localTargetVerified: true, contract: 'PASS', applied: Boolean(applied || mode === '--apply'), checkedAt: new Date().toISOString() };
fs.writeFileSync(`${root}/${mode.slice(2)}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
