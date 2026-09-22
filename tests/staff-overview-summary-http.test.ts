import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
import { getStaffOverviewLegacyData, getStaffOverviewData, type StaffOverviewData } from "@/features/school/home/staff-overview-data";

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
// 界面会按姓名重排人员选项；这里比较全量目录内容，不依赖 Map 的插入顺序。
const normalize = (data: StaffOverviewData) => ({ ...data, supportDirectory: [...data.supportDirectory].sort((a, b) => a.userId.localeCompare(b.userId)) });

it.skipIf(process.env.MATHIN_OVERVIEW_SUMMARY_HTTP_TEST !== "1")("compares complete overview summaries over authenticated PostgREST", async () => {
  const root = ".tmp/overview-summary-20260922";
  fs.mkdirSync(root, { recursive: true });
  const { observed } = openHistoryLocalTarget({ attestationPath: `${root}/http-target.json`, refresh: true, errorFile: `${root}/http-error.private.txt` });
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
  const requests: Array<{ path: string; bytes: number; ms: number; status: number }> = [];
  state.client = createClient(observed.supabaseOrigin!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const started = performance.now(), response = await fetch(input, init);
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (!path.startsWith("/rest/v1/")) return response;
      return new Proxy(response, { get(target, property) {
        if (property === "text") return async () => {
          const body = await target.text();
          requests.push({ path, bytes: Buffer.byteLength(body), ms: performance.now() - started, status: response.status });
          return body;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    } },
  });
  const samples: Array<{ role: string; grain: string; date: string; baseline: { ms: number; bytes: number; calls: number }; candidate: { ms: number; bytes: number; calls: number }; digest: string }> = [];
  const differences: string[] = [], comparisons: unknown[] = [];
  const now = new Date("2026-09-22T04:12:37.123Z");
  const measure = async <T,>(read: () => Promise<T>) => {
    requests.length = 0;
    const started = performance.now(), data = await read();
    return { data, ms: performance.now() - started, bytes: requests.reduce((sum, row) => sum + row.bytes, 0), requests: [...requests] };
  };
  try {
    for (const role of ["admin", "principal", "teacher", "research"] as const) {
      expect((await state.client.auth.signInWithPassword(loadFixedAccount(role)!)).error).toBeNull();
      for (const period of [{ grain: "month" as const, date: "current" }, { grain: "month" as const, date: "previous" },
        { grain: "week" as const, date: "current" }, { grain: "week" as const, date: "2026-08-17" }]) {
        const baseline = await measure(() => getStaffOverviewLegacyData({ ...period, now }));
        const candidate = await measure(() => getStaffOverviewData({ ...period, now }));
        const expected = normalize(baseline.data), actual = normalize(candidate.data);
        if (digest(expected) !== digest(actual)) differences.push(`${role}/${period.grain}/${period.date}`);
        comparisons.push({ role, ...period, expected, actual, requests: candidate.requests });
        samples.push({ role, ...period, baseline: { ms: baseline.ms, bytes: baseline.bytes, calls: baseline.requests.length },
          candidate: { ms: candidate.ms, bytes: candidate.bytes, calls: candidate.requests.length }, digest: digest(actual) });
        expect(candidate.requests.filter(row => row.status !== 200).map(({ path, status }) => ({ path, status })))
          .toEqual(baseline.requests.filter(row => row.status !== 200).map(({ path, status }) => ({ path, status })));
        expect(candidate.requests.filter(row => row.path.endsWith("/get_staff_overview_acquisition_contacts_v2"))).toHaveLength(1);
        expect(candidate.requests.filter(row => row.path.endsWith("/get_organization_timezone_v2"))).toHaveLength(1);
        expect(candidate.requests.some(row => ["/list_current_staff_overview_acquisition_sources", "/statistics_lead_communications", "/statistics_lead_source_records"].some(path => row.path.endsWith(path)))).toBe(false);
        expect(candidate.requests.length).toBeLessThan(baseline.requests.length);
        if (role === "admin") {
          expect(candidate.bytes).toBeLessThan(3_500_000);
          expect(candidate.ms).toBeLessThan(1_000);
        }
      }
      await state.client.auth.signOut({ scope: "local" });
    }
  } finally {
    fs.writeFileSync(`${root}/http.private.json`, JSON.stringify(comparisons, null, 2));
    fs.writeFileSync(`${root}/http.json`, JSON.stringify({ checkedAt: new Date().toISOString(), samples, differences }, null, 2));
    await state.client.auth.signOut({ scope: "local" });
  }
  expect(differences).toEqual([]);
  console.log(JSON.stringify({ cases: samples.length, first: samples[0] }));
}, 90_000);
