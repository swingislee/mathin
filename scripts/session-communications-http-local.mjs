import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';

const output = path.resolve('.tmp/session-communications');
fs.mkdirSync(output, { recursive: true });
openHistoryLocalTarget({ attestationPath: path.join(output, 'preflight.json'), refresh: false, errorFile: path.join(output, 'database-error.txt') });
loadEnvFile('.env.local');
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:35421') throw new Error('LOCAL_ORIGIN_REQUIRED');
const account = loadFixedAccount('teacher');
if (!account) throw new Error('FIXED_TEACHER_REQUIRED');
const jar = new Map();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...jar].map(([name,value]) => ({name,value})), setAll: values => { for (const {name,value} of values) jar.set(name,value); } },
});
const auth = await client.auth.signInWithPassword(account);
if (auth.error) throw new Error('FIXED_TEACHER_SIGNIN_FAILED');
const classes = await client.rpc('list_classrooms_for_scope',{p_scope:'teaching',p_filters:{purpose:'test'},p_page:1});
if (classes.error || !classes.data?.length) throw new Error('FIXED_TEACHER_CLASSROOM_REQUIRED');
const {data: rows, error} = await client.from('class_sessions').select('id').in('classroom_id',classes.data.map(row=>row.id)).is('deleted_at',null).is('voided_at',null).is('cancelled_by',null).limit(1);
if (error || !rows?.length) throw new Error('FIXED_TEACHER_SESSION_REQUIRED');
const sessionId = rows[0].id;
const results = [];
for (const locale of ['zh','en']) {
  for (const [name, route, marker] of [
    ['classes', `/${locale}/dashboard/classes?scope=teaching&purpose=test`, 'data-personal-classroom-table'],
    ['postwork', `/${locale}/dashboard/sessions/${sessionId}?stage=post`, 'data-session-postwork-table'],
  ]) {
    const response = await fetch(`http://127.0.0.1:3130${route}`, {
      headers: { cookie: [...jar].map(([name,value]) => `${name}=${value}`).join('; ') }, redirect: 'manual', signal: AbortSignal.timeout(60000),
    });
    const html = await response.text();
    const result = {locale, page:name, status:response.status, rendered:html.includes(marker)};
    results.push(result); console.log(JSON.stringify(result));
    if (response.status !== 200 || !result.rendered) throw new Error('LOCAL_PAGE_CONTRACT_FAILED');
  }
}
fs.writeFileSync(path.join(output,'http-check.json'),JSON.stringify(results,null,2),'utf8');
