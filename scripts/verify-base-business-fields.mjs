import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServerClient } from '@supabase/ssr';
import { loadFixedAccount } from '../e2e/support/fixed-accounts.ts';
import { openHistoryLocalTarget } from './lib/history-local-target.mjs';
import { baseBusinessFieldsSchema, baseLeadAcquisitionSchema } from '../src/features/school/base-business-fields-schema.mjs';
import { schoolRecordContextSchema } from '../src/features/school/school-record-review-contract.ts';

const base = new URL(process.argv[2]);
const hosts = new Set(['localhost', '127.0.0.1', ...Object.values(os.networkInterfaces()).flatMap(items => (items ?? []).map(item => item.address))]);
if (base.protocol !== 'http:' || base.port !== '3130' || !hosts.has(base.hostname)) throw new Error('LOCAL_DEV_URL_REQUIRED');
const root = path.resolve('.tmp/base-data-organization');
openHistoryLocalTarget({ attestationPath: path.join(root, 'preflight.json'), refresh: true, errorFile: path.join(root, 'database-error.txt') });
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
}));
const plan = JSON.parse(fs.readFileSync(path.join(root, 'plan.json'), 'utf8'));
const expected = new Map(plan.facts.map(fact => [fact.source_record_id, baseBusinessFieldsSchema.parse(fact.fields)]));
const results = [];
for (const role of ['admin', 'teacher', 'student']) {
  const account = loadFixedAccount(role);
  if (!account) throw new Error('FIXED_ACCOUNT_REQUIRED');
  const cookies = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)) },
  });
  if ((await client.auth.signInWithPassword(account)).error) throw new Error(`FIXED_LOGIN_FAILED:${role}`);
  try {
    if (role !== 'admin') {
      const archive = await client.rpc('read_base_source_business_fields', { p_source_id: plan.facts[0].source_record_id });
      if (archive.error?.message !== 'FORBIDDEN') throw new Error(`BASE_ARCHIVE_ROLE:${role}`);
      const acquisition = await client.rpc('read_base_lead_acquisition', { p_lead_ids: [] });
      if (role === 'student' && acquisition.error?.message !== 'FORBIDDEN') throw new Error('BASE_NONSTAFF_RPC');
      if (role === 'teacher' && acquisition.error) throw new Error(`BASE_TEACHER_EMPTY_RPC:${acquisition.error.message}`);
      results.push({ role, archiveScope: 'PASS', acquisitionScope: 'PASS' });
      if (role === 'student') continue;
    } else {
      const leadIds = await client.from('collaborative_leads').select('id').order('id').limit(500);
      if (leadIds.error) throw new Error('BASE_LEADS_READ');
      const started = Date.now();
      const acquisition = await client.rpc('read_base_lead_acquisition', { p_lead_ids: leadIds.data.map(row => row.id) });
      if (acquisition.error) throw new Error(`BASE_ACQUISITION_RPC:${acquisition.error.message}`);
      const values = baseLeadAcquisitionSchema.parse(acquisition.data);
      const sample = values.find(row => row.sources.length);
      if (!sample) throw new Error('ACTUAL_BASE_ACQUISITION_REQUIRED');
      const source = sample.sources[0];
      const archive = await client.rpc('read_base_source_business_fields', { p_source_id: source.sourceId });
      if (archive.error) throw new Error('BASE_ARCHIVE_RPC');
      assert.deepEqual(baseBusinessFieldsSchema.parse(archive.data), expected.get(source.sourceId));
      const context = await client.rpc('read_school_record_source_context', { p_student_id: null, p_lead_id: sample.leadId, p_page: 1 });
      if (context.error) throw new Error('BASE_CONTEXT_RPC');
      const data = schoolRecordContextSchema.parse(context.data);
      let compared = 0;
      for (const row of data.sources) if (expected.has(row.id)) {
        assert.deepEqual(row.businessFields, expected.get(row.id));
        for (const field of row.businessFields) {
          if (field.originalText.trim()) assert.equal(row.cells.find(cell => cell.id === field.fieldId)?.text, field.originalText);
        }
        compared++;
      }
      if (!compared) throw new Error('ACTUAL_BASE_CONTEXT_REQUIRED');
      results.push({ role, actualSourcesCompared: compared, acquisitionLeads: values.filter(row => row.sources.length).length,
        rpcMs: Date.now() - started, sourceFieldsEqual: true });
      console.log(JSON.stringify(results.at(-1)));
    }
    const routes = role === 'admin' ? ['followups/leads?scope=all', 'history-import', 'students?scope=all'] : ['followups/leads?scope=mine'];
    for (const locale of ['zh', 'en']) for (const route of routes) {
      const started = Date.now();
      const response = await fetch(new URL(`/${locale}/dashboard/${route}`, base), { headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
        redirect: 'manual', signal: AbortSignal.timeout(60000) });
      const html = await response.text();
      if (response.status !== 200 || /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|"digest":"\d+"/.test(html)) {
        fs.writeFileSync(path.join(root, 'page-error.html'), html, 'utf8');
        throw new Error(`BASE_PAGE_FAILED:${role}:${locale}:${route}:${response.status}`);
      }
      if (role === 'admin' && route.startsWith('followups/leads') && !html.includes('data-lead-intake-row')) throw new Error('BASE_LEAD_TABLE_MISSING');
      const result = { role, locale, route, status: response.status, ms: Date.now() - started };
      results.push(result); console.log(JSON.stringify(result));
    }
  } finally { await client.auth.signOut({ scope: 'local' }); }
}
fs.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2), 'utf8');
console.log(JSON.stringify({ contracts: 'PASS', bilingualPages: 'PASS', businessWrites: false }));
