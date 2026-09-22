import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { openOverviewAggregateLocal, aggregateRoot as root, aggregateMigration as migration, aggregateAssertions as assertions } from "../scripts/lib/overview-aggregate-local.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { getStaffOverviewLegacyData as getStaffOverviewData } from "@/features/school/home/staff-overview-data";
import { buildStaffOverviewWindow } from "@/features/school/home/staff-overview-contract";
import { readSourceMetricFacts } from "@/features/school/source-metric-facts-contract";
import { overviewAcquiredOn } from "@/features/school/home/staff-overview-acquisition-contract";

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
type Metric = "leads" | "contacts";
type Person = { personId: string | null; current: number; previous: number };
type MetricResult = { available: boolean; missingDates: number; comparison: unknown; people: Person[] };
type Result = { schemaVersion: number; metrics: Record<Metric, MetricResult> };
const normalize = (value: Result) => Object.fromEntries((["leads", "contacts"] as const).map(key => [key, {
  ...value.metrics[key],
  people: [...value.metrics[key].people].sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? "")),
}]));

describe.skipIf(process.env.MATHIN_OVERVIEW_AGGREGATE_DB_TEST !== "1")("overview database aggregation", () => {
  it("matches real authorized period totals, trends and staff attribution and rolls back the migration", async () => {
    const { sql, footprint } = openOverviewAggregateLocal();
    const before = footprint();
    const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
      const match = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);
      return match ? [[match[1], match[2].trim()]] : [];
    }));
    let bytes = 0, calls = 0;
    state.client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (!String(input).includes("/rest/v1/")) return response;
        calls += 1;
        return new Proxy(response, { get(target, property) {
          if (property === "text") return async () => { const body = await target.text(); bytes += Buffer.byteLength(body); return body; };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      } },
    });
    const now = new Date("2026-09-21T04:12:37.123Z");
    const cases: Array<{ role: "admin" | "principal" | "teacher" | "research"; grain: "week" | "month"; date: string; window: unknown; expected: Result; bytes: number; calls: number; ms: number }> = [];
    try {
      for (const role of ["admin", "principal", "teacher", "research"] as const) {
        const account = loadFixedAccount(role); if (!account) throw Error("FIXED_ACCOUNT_REQUIRED");
        const login = await state.client.auth.signInWithPassword(account); if (login.error) throw Error("FIXED_LOGIN_FAILED");
        const periods = [{ grain: "month" as const, date: "current" }, { grain: "month" as const, date: "previous" }, { grain: "week" as const, date: "current" }, { grain: "week" as const, date: "2026-08-17" },
          ...(role === "admin" ? ["2026-02-01", "2026-03-01", "2026-06-01", "2026-07-01"].map(date => ({ grain: "month" as const, date })) : [])];
        for (const period of periods) {
          bytes = 0; calls = 0;
          const started = performance.now();
          const data = await getStaffOverviewData({ ...period, now });
          const ms = performance.now() - started;
          const window = buildStaffOverviewWindow(period.grain, now, data.timeZone, period.date);
          if (period.grain === "month") window.previousCutoff = window.previousEnd;
          const metrics = Object.fromEntries((["leads", "contacts"] as const).map(key => {
            const fact = data.businessFacts.find(fact => fact.key === key)!;
            const available = fact.current !== null;
            return [key, { available, missingDates: data.missingDateCounts[key] ?? 0,
              comparison: available ? { current: fact.current, previous: fact.previous, trend: fact.trend } : null,
              people: available ? data.supportFunnelRows.filter(row => (row.metrics[key].current ?? 0) > 0 || (row.metrics[key].previous ?? 0) > 0)
                .map(row => ({ personId: row.userId, current: row.metrics[key].current!, previous: row.metrics[key].previous! })) : [],
            }];
          })) as Result["metrics"];
          cases.push({ role, ...period, window, expected: { schemaVersion: 2, metrics }, bytes, calls, ms });
        }
        await state.client.auth.signOut({ scope: "local" });
      }
    } finally { await state.client.auth.signOut({ scope: "local" }); }
    const validFacts = { version: 1, sourceKey: "fixture-key", sourceName: "fixture", sourceTable: "fixture", sourceVersion: "2026-09-01", scope: "selection", confirmed: { contacts: true }, months: { contacts: "2026-09" }, staff: { contacts: "fixture" }, evidence: [] };
    const projections: unknown[] = [null, {}, validFacts, { ...validFacts, months: {} }, { ...validFacts, months: { contacts: null } },
      { ...validFacts, months: { contacts: "2026-13" } }, { ...validFacts, confirmed: { contacts: true, arrivals: null } },
      { ...validFacts, staff: [] }, { ...validFacts, months: [], confirmed: [] }, { ...validFacts, evidence: "invalid" }, { ...validFacts, sourceKey: "" }];
    const claims = (role: "admin" | "principal" | "teacher" | "research" | "student" | "parent") => `select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from auth.users where email=${quote(loadFixedAccount(role)!.email)}),'role','authenticated')::text,true) is not null;set local role authenticated;`;
    const queries = cases.map((item, index) => `${claims(item.role)}select jsonb_build_object('kind','case','index',${index},'result',public.get_staff_overview_acquisition_contacts_v2(${quote(JSON.stringify(item.window))}::jsonb));reset role;`).join("\n");
    const projectionQueries = projections.map((value, index) => `select jsonb_build_object('kind','projection','index',${index},'result',to_jsonb(public.project_overview_contact_v2(${quote(JSON.stringify(value))}::jsonb)));`).join("\n");
    const dateCases = [["2024-02-29", ""], ["2026-02-29", ""], ["2026年9月1日", ""], ["2026/09/01T12:40:11.123+0800", ""],
      ["0099-01-01", ""], ["2026-13-01", ""], ["9/1", "2026-09-08"], ["9/1", "2026-09-09"], ["9/1", "2026-08-31"],
      ["9/8", "2026-09-01"], ["2026-09-01 invalid", ""], ["\u00a02026-09-01\u3000", ""], ["v2026-09-01v", ""], ["\v2026-09-01\v", ""]];
    const dateQueries = dateCases.map(([raw, anchor], index) => `select jsonb_build_object('kind','date','index',${index},'result',(public.project_overview_acquisition_v2(${quote(JSON.stringify({ cells: [{ fieldName: "获取日期", text: raw }, { fieldName: "登记日期（此列不用填，自动生成）", text: anchor }] }))}::jsonb)).acquired_on);`).join("\n");
    const windowJson = quote(JSON.stringify(cases[0].window));
    const denied = (["student", "parent"] as const).map(role => `${claims(role)}do $deny$ begin
      if exists(select 1 from public.staff_overview_acquisition_contact_facts_v2('month','Asia/Shanghai')) then raise exception 'NON_STAFF_FACT_LEAK';end if;
      begin perform public.get_staff_overview_acquisition_contacts_v2(${windowJson}::jsonb);raise exception 'NON_STAFF_SUMMARY_LEAK';
      exception when raise_exception then if sqlerrm<>'FORBIDDEN' then raise;end if;end;
      end;$deny$;reset role;`).join("\n");
    const prepared = `${claims("admin")}prepare aggregate_actor as select public.get_staff_overview_acquisition_contacts_v2(${windowJson}::jsonb) as result;reset role;
      ${(["admin", "teacher", "admin"] as const).map(role => `${claims(role)}execute aggregate_actor;reset role;`).join("\n")}deallocate aggregate_actor;`;
    const samples = `create temporary table aggregate_samples(ms numeric,bytes integer);grant insert,select on aggregate_samples to authenticated;
      ${claims("admin")}do $measure$ declare started timestamptz;r jsonb;begin for i in 1..5 loop started:=clock_timestamp();
      r:=public.get_staff_overview_acquisition_contacts_v2(${windowJson}::jsonb);
      insert into aggregate_samples values(extract(epoch from clock_timestamp()-started)*1000,octet_length(r::text));end loop;end;$measure$;
      select jsonb_build_object('kind','sample','ms',ms,'bytes',bytes) from aggregate_samples;
      explain(analyze,buffers,format json) select public.get_staff_overview_acquisition_contacts_v2(${windowJson}::jsonb);reset role;`;
    const body = fs.readFileSync(migration, "utf8");
    const output = sql(`begin;set local lock_timeout='3s';set local statement_timeout='90s';${body}\n${projectionQueries}\n${dateQueries}\n${queries}\n${denied}\n${prepared}\n${samples}
      ${claims("admin")}reset role;select set_config('mathin.aggregate_window',${windowJson},true) is not null;
      set local role postgres;${fs.readFileSync('scripts/sql/current-overview-acquisition-fixtures.sql', 'utf8')}reset role;
      ${fs.readFileSync(assertions, 'utf8')}select '{"kind":"safety","passed":true}'::jsonb;rollback;`);
    const rows = output.split(/\r?\n/).filter(line => line.startsWith("{")).map(line => JSON.parse(line));
    fs.writeFileSync(`${root}/comparison.private.json`, JSON.stringify({ cases, rows }, null, 2));
    expect(footprint()).toBe(before);
    for (const row of rows.filter(row => row.kind === "date")) expect(row.result, `date ${row.index}`).toBe(overviewAcquiredOn(...dateCases[row.index] as [string, string]));
    for (const row of rows.filter(row => row.kind === "projection")) {
      const parsed = readSourceMetricFacts(projections[row.index]);
      const expected = parsed ? { source_key: parsed.sourceKey, source_version: parsed.sourceVersion, source_scope: parsed.scope,
        confirmed: parsed.confirmed.contacts ?? null, month_state: parsed.months.contacts === undefined ? 0 : parsed.months.contacts === null ? 1 : 2,
        reporting_month: parsed.months.contacts ?? null, staff_label: parsed.staff.contacts ?? "" } : null;
      expect(row.result, `projection ${row.index}`).toEqual(expected);
    }
    const differences: string[] = [];
    for (const row of rows.filter(row => row.kind === "case")) {
      const item = cases[row.index];
      if (digest(normalize(row.result)) !== digest(normalize(item.expected))) differences.push(`${item.role}/${item.grain}/${item.date}`);
    }
    const cached = rows.filter(row => row.schemaVersion === 2);
    expect(cached).toHaveLength(3);
    for (let index = 0; index < cached.length; index++) {
      const expected = cases.find(item => item.role === (index === 1 ? "teacher" : "admin") && item.grain === "month" && item.date === "current")!;
      if (digest(normalize(cached[index])) !== digest(normalize(expected.expected))) differences.push(`cached-actor-${index}`);
    }
    const plan = JSON.parse(output.match(/^\[\r?\n[\s\S]+?^\]/m)![0])[0];
    fs.writeFileSync(`${root}/plan.json`, JSON.stringify(plan, null, 2));
    const safetyPassed = rows.some(row => row.kind === "safety" && row.passed);
    fs.writeFileSync(`${root}/check.json`, JSON.stringify({ checksum: textFileSha256(migration), assertionsChecksum: textFileSha256(assertions), before, cases: cases.map(({ expected, window, ...metadata }) => ({ ...metadata, digest: digest(normalize(expected)), windowDigest: digest(window) })), differences, safetyPassed, rollbackUnchanged: true, sqlMs: plan["Execution Time"], samples: rows.filter(row => row.kind === "sample") }, null, 2));
    expect(rows.filter(row => row.kind === "case")).toHaveLength(cases.length);
    expect(differences, "Private comparison recorded; no business values in failure output").toEqual([]);
    expect(safetyPassed).toBe(true);
    console.log(JSON.stringify({ cases: cases.length, projectionCases: projections.length, dateCases: dateCases.length, rollbackUnchanged: true, baselineBytes: cases[0].bytes, baselineMs: cases[0].ms, sqlMs: plan["Execution Time"] }));
  }, 180_000);
});
