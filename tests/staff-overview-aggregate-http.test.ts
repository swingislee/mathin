import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadFixedAccount, type FixedAccountRole } from "../e2e/support/fixed-accounts";
import { openOverviewAggregateLocal, aggregateRoot as root, aggregateMigration as migration } from "../scripts/lib/overview-aggregate-local.mjs";
import { textFileSha256 } from "../scripts/lib/text-hash.mjs";
import { readStaffOverviewAcquisitionContacts } from "@/features/school/home/staff-overview-aggregate-read";
import type { OverviewAcquisitionContactSummary } from "@/features/school/home/staff-overview-aggregate-contract";

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const digest = (value: OverviewAcquisitionContactSummary) => createHash("sha256").update(JSON.stringify(canonical(Object.fromEntries(
  (["leads", "contacts"] as const).map(key => [key, { ...value.metrics[key], people: [...value.metrics[key].people].sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? "")) }]),
)))).digest("hex");

it.skipIf(process.env.MATHIN_OVERVIEW_AGGREGATE_HTTP_TEST !== "1")("serves the validated summaries over real PostgREST using only timezone and summary requests", async () => {
  openOverviewAggregateLocal();
  const apply = JSON.parse(fs.readFileSync(`${root}/apply.json`, "utf8"));
  const baseline = JSON.parse(fs.readFileSync(`${root}/check.json`, "utf8")) as {
    checksum: string; differences: string[];
    cases: Array<{ role: FixedAccountRole; grain: "week" | "month"; date: string; digest: string }>;
  };
  expect(apply.checksum).toBe(textFileSha256(migration));
  expect(baseline.checksum).toBe(apply.checksum);
  expect(baseline.differences).toEqual([]);
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
  let calls: Array<{ endpoint: string; bytes: number }> = [];
  state.client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (!String(input).includes("/rest/v1/")) return response;
      return new Proxy(response, { get(target, property) {
        if (property === "text") return async () => {
          const body = await target.text(); calls.push({ endpoint: new URL(String(input)).pathname, bytes: Buffer.byteLength(body) }); return body;
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      } });
    } },
  });
  const samples: Array<{ role: string; grain: string; date: string; ms: number; bytes: number; calls: number }> = [];
  let role: FixedAccountRole | undefined;
  const now = new Date("2026-09-21T04:12:37.123Z");
  try {
    for (const item of [...baseline.cases, ...Array.from({ length: 5 }, () => baseline.cases[0])]) {
      if (role !== item.role) {
        const login = await state.client.auth.signInWithPassword(loadFixedAccount(item.role)!);
        if (login.error) throw Error("FIXED_LOGIN_FAILED");
        role = item.role;
      }
      calls = [];
      const started = performance.now();
      const result = await readStaffOverviewAcquisitionContacts({ grain: item.grain, date: item.date, now });
      const ms = performance.now() - started;
      expect(digest(result), `${item.role}/${item.grain}/${item.date}`).toBe(item.digest);
      expect(calls.map(call => call.endpoint)).toEqual(["/rest/v1/rpc/get_organization_timezone_v2", "/rest/v1/rpc/get_staff_overview_acquisition_contacts_v2"]);
      const bytes = calls.reduce((sum, call) => sum + call.bytes, 0);
      expect(bytes).toBeLessThan(30_000);
      samples.push({ role: item.role, grain: item.grain, date: item.date, ms, bytes, calls: calls.length });
    }
  } finally { await state.client.auth.signOut({ scope: "local" }); }
  fs.writeFileSync(`${root}/http.json`, JSON.stringify({ checkedAt: new Date().toISOString(), checksum: apply.checksum, samples }, null, 2));
  console.log(JSON.stringify({ cases: baseline.cases.length, first: samples[0], repeats: samples.slice(-5), fullPageMeasured: false }));
}, 90_000);
