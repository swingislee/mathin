import fs from "node:fs";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";

const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
import { getStaffOverviewData } from "@/features/school/home/staff-overview-data";

it.skipIf(process.env.MATHIN_STATISTICS_BATCH_HTTP_TEST !== "1")("keeps complete administrator statistics within the real read budget", async () => {
  const root = ".tmp/overview-repair-20260922";
  fs.mkdirSync(root, { recursive: true });
  const { observed } = openHistoryLocalTarget({ attestationPath: `${root}/http-target.json`, refresh: true, errorFile: `${root}/http-error.private.txt` });
  const origin = observed.supabaseOrigin;
  if (!origin) throw new Error("LOCAL_SUPABASE_ORIGIN_REQUIRED");
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);
    return match ? [[match[1], match[2].trim()]] : [];
  }));
  const requests: Array<{ path: string; ms: number; status: number }> = [];
  state.client = createClient(origin, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const started = performance.now();
      const response = await fetch(input, init);
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path.startsWith("/rest/v1/")) {
        await response.clone().arrayBuffer();
        requests.push({ path, ms: performance.now() - started, status: response.status });
      }
      return response;
    } },
  });
  const results: Array<{ ms: number; digest: string; calls: number; slowestReadMs: number }> = [];
  try {
    expect((await state.client.auth.signInWithPassword(loadFixedAccount("admin")!)).error).toBeNull();
    for (let run = 0; run < 3; run++) {
      requests.length = 0;
      const started = performance.now();
      const data = await getStaffOverviewData({ grain: "month", date: "2026-09-01", now: new Date("2026-09-21T12:00:00Z") });
      const ms = performance.now() - started;
      expect(data.unavailableSources).toEqual([]);
      expect(data.truncatedSources).toEqual([]);
      expect(data.businessFacts).toHaveLength(6);
      expect(data.businessFacts.every(fact => fact.current !== null)).toBe(true);
      expect(requests.every(request => request.status === 200)).toBe(true);
      const stable = { ...data, generatedAt: undefined };
      const digest = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
      const slowestReadMs = Math.max(...requests.map(request => request.ms));
      results.push({ ms, digest, calls: requests.length, slowestReadMs });
      if (run > 0) expect(digest).toBe(results[0].digest);
      // 这是数据库读取门槛；浏览器可操作时间由真实页面另行验收。
      expect(ms).toBeLessThan(2_000);
      expect(slowestReadMs).toBeLessThan(1_000);
    }
  } finally {
    fs.writeFileSync(`${root}/reader-budget.json`, JSON.stringify(results, null, 2));
    await state.client.auth.signOut({ scope: "local" });
  }
}, 30_000);
