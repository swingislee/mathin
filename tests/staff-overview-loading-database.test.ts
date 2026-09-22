import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { getStaffOverviewLegacyData as getStaffOverviewData } from "@/features/school/home/staff-overview-data";
import { listMyWorkItems } from "@/features/school/work-items";
import { readMonthlyTargets } from "@/features/school/home/monthly-targets-data";
import { calendarDayKey } from "@/features/school/schedule";

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));

describe.skipIf(process.env.MATHIN_OVERVIEW_DB_TEST !== "1")("overview real read critical path", () => {
  it("preserves the full administrator overview while reading acquisitions once", async () => {
    const root = ".tmp/overview-loading-database";
    fs.mkdirSync(root, { recursive: true });
    openHistoryLocalTarget({ attestationPath: `${root}/target.json`, refresh: true, errorFile: `${root}/error.private.txt` });
    const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
      const m = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);
      return m ? [[m[1], m[2].trim()]] : [];
    }));
    let origin = performance.now();
    const requests: Array<{ path: string; start: number; headersAt?: number; end?: number; bytes?: number; status?: number }> = [];
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (!url.pathname.startsWith("/rest/v1/")) return fetch(input, init);
        const request = { path: url.pathname, start: performance.now() - origin } as typeof requests[number];
        requests.push(request);
        const response = await fetch(input, init);
        request.headersAt = performance.now() - origin;
        request.status = response.status;
        return new Proxy(response, { get(target, property) {
          if (property === "text") return async () => {
            const body = await target.text();
            request.end = performance.now() - origin;
            request.bytes = Buffer.byteLength(body);
            return body;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
      } },
    });
    let legacyPages = false;
    state.client = new Proxy(client, { get(target, property) {
      if (property === "rpc" && legacyPages) return async (name: string, args?: Record<string, unknown>) => {
        if (name !== "list_current_staff_overview_acquisition_sources") return target.rpc(name, args);
        const records = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const result = await target.rpc(name, { p_limit: 1000, ...(cursor ? { p_after: cursor } : {}) });
          if (result.error) return result;
          records.push(...result.data.records);
          if (!result.data.hasMore || page === 9) return { ...result, data: { ...result.data, records } };
          cursor = result.data.records.at(-1).id;
        }
        throw Error("ACQUISITION_PAGE_BOUND");
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const account = loadFixedAccount("admin");
    if (!account) throw Error("FIXED_ACCOUNT_REQUIRED");
    const login = await state.client.auth.signInWithPassword(account);
    if (login.error) throw Error("FIXED_LOGIN_FAILED");
    try {
      const results = [];
      const now = new Date();
      let baselineDigest: string | undefined;
      for (let run = 0; run < 3; run++) {
        legacyPages = run === 0;
        origin = performance.now(); requests.length = 0;
        const work = listMyWorkItems().then(items => ({ count: items.length, end: performance.now() - origin }));
        const data = await getStaffOverviewData({ grain: "month", date: "current", now });
        const dataEnd = performance.now() - origin;
        const dataRequests = requests.slice();
        const workResult = await work;
        const goalsStart = performance.now() - origin;
        await readMonthlyTargets(calendarDayKey(new Date(data.currentStart), data.timeZone).slice(0, 7));
        const end = performance.now() - origin;
        expect(data.unavailableSources).toEqual([]);
        expect(data.truncatedSources).toEqual([]);
        expect(requests.every(request => request.status === 200)).toBe(true);
        const digest = createHash("sha256").update(JSON.stringify(data)).digest("hex");
        if (legacyPages) baselineDigest = digest;
        else expect(digest).toBe(baselineDigest);
        const acquisitionCalls = requests.filter(request => request.path.endsWith("/list_current_staff_overview_acquisition_sources")).length;
        if (!legacyPages) expect(acquisitionCalls).toBe(1);
        const result = { run, mode: legacyPages ? "legacy-pages" : "snapshot", digest, acquisitionCalls, dataEnd, dataLastRead: Math.max(...dataRequests.map(request => request.end ?? 0)),
          workEnd: workResult.end, goalsMs: end - goalsStart, end, calls: requests.length,
          bytes: requests.reduce((sum, request) => sum + (request.bytes ?? 0), 0), requests: requests.slice() };
        results.push(result);
        console.log(JSON.stringify({ ...result, requests: result.requests.filter(request => (request.end ?? 0) - request.start > 100) }));
      }
      fs.writeFileSync(`${root}/reader-comparison.json`, JSON.stringify(results, null, 2) + "\n");
    } finally { await state.client.auth.signOut({ scope: "local" }); }
  }, 60_000);
});
