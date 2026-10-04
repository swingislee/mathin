import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { schoolRecordContextSchema } from '../src/features/school/school-record-review-contract.ts';

const base = new URL(process.argv[2]);
const hosts = new Set(['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flatMap(items => (items ?? []).map(item => item.address))]);
if (base.protocol !== 'http:' || base.port !== '3130' || !hosts.has(base.hostname)) throw new Error('LOCAL_DEV_URL_REQUIRED');
const root = path.resolve('.tmp/base-activity-associations');
openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/u).filter(line => /^[A-Z_]+=/u.test(line)).map(line => {
  const at = line.indexOf('=');return [line.slice(0,at),line.slice(at+1).trim().replace(/^(["'])(.*)\1$/u,'$2')];
}));
const account = loadFixedAccount('admin');
if (!account) throw new Error('FIXED_ADMIN_REQUIRED');
const cookies = new Map();
const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: values => values.forEach(({name,value}) => cookies.set(name,value)) },
});
if ((await client.auth.signInWithPassword(account)).error) throw new Error('FIXED_ADMIN_LOGIN_FAILED');
const results = [];
try {
  for (const link of plan.links) {
    const { data, error } = await client.rpc('read_school_record_source_context', { p_student_id: link.student_id, p_lead_id: link.lead_id, p_page: 1 });
    if (error) throw new Error('SOURCE_FRAGMENT_RPC_FAILED');
    const context = schoolRecordContextSchema.parse(data);
    const own = context.sources.filter(row => plan.links.some(item => item.id === row.id));
    assert.equal(own.length, 1);
    assert.equal(own[0].id, link.id);
    assert.equal(own[0].association, 'inferred');
    assert.deepEqual(own[0].businessFields, link.business_fields);
    assert.equal(own[0].cells.length, 1);
    assert.equal(own[0].cells[0].text, link.original_text);
    assert.equal(context.sources[0].id, link.id);
    results.push({ sourceEntry: link.entry_index, actualFragmentMatches: true, inferredLabelState: true });
  }
  for (const locale of ['zh','en']) {
    const response = await fetch(new URL(`/${locale}/dashboard/followups/leads`,base), { headers: { cookie: [...cookies].map(([name,value]) => `${name}=${value}`).join('; ') },
      redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const html = await response.text();
    if (response.status !== 200 || /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|"digest":"\d+"/u.test(html)) throw new Error(`SOURCE_FRAGMENT_PAGE_FAILED:${locale}:${response.status}`);
    results.push({ locale, status: response.status });
  }
} finally { await client.auth.signOut({ scope: 'local' }); }
fs.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2), 'utf8');
console.log(JSON.stringify({ inferredSources: plan.links.length, actualFieldsEqual: true, bilingualPages: 'PASS', businessWrites: false }));
