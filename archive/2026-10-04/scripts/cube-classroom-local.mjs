import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

// 新协议复用既有课堂表与授权；本配方只做只读目标核对和回滚事务验证。
const mode = process.argv[2];
if (!['--preflight', '--check'].includes(mode)) throw new Error('Use --preflight or --check');
const output = path.resolve('.tmp/cube-classroom');
fs.mkdirSync(output, { recursive: true });
const { sql, observed } = openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: mode === '--preflight', errorFile: path.join(output, 'database-error.txt') });
if (mode === '--preflight') { console.log(JSON.stringify(observed)); process.exit(0); }
const remaining = () => sql("begin read only; select count(*) from public.classrooms where name='__CUBE_CLASSROOM_STATE_TRANSACTION__'; commit;");
assert.equal(remaining(), '0', 'Existing verification root requires review');
sql(fs.readFileSync('supabase/tests/cube_classroom_state_assertions.sql', 'utf8'));
assert.equal(remaining(), '0', 'Classroom verification transaction did not roll back');
fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify({ checkedAt: new Date().toISOString(), host: observed.host,
  durableEvent: 'PASS', teacherOnly: 'PASS', memberRead: 'PASS', outsiderDenied: 'PASS', payloadCap: 'PASS', rollback: 'PASS' }), 'utf8');
console.log('Local classroom tool_state persistence, teacher-only writes, member replay, outsider denial, payload cap and transaction rollback: PASS');
