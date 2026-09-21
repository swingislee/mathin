import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { loadFixedAccount } from "../e2e/support/fixed-accounts";
import { openHistoryLocalTarget } from "../scripts/lib/history-local-target.mjs";
const state = vi.hoisted(() => ({ client: null as unknown as SupabaseClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
import { getStaffOverviewData } from "@/features/school/home/staff-overview-data";
import { getStaffStats, getFollowUpFunnel, getFinanceOverview, getRosterMismatchCount } from "@/features/school/dashboard";
import { getManagementAnalyticsData } from "@/features/school/management-analytics";
import { listStaffMembers, listStaffRoles } from "@/features/school/staff";
import { countPendingRefunds } from "@/features/school/finance";

it.skipIf(process.env.MATHIN_STATISTICS_HTTP_TEST !== "1")("reads production statistics through real RLS and preserves test identities in their directories", async () => {
  const root=".tmp/production-test-statistics-20260921";
  openHistoryLocalTarget({attestationPath:root+"/local-target.json",refresh:true,errorFile:root+"/http-error.private.txt"});
  const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z_]+)\s*=\s*["']?([^\r\n"']*)/.exec(line);return match ? [[match[1], match[2].trim()]] : [];
  }));
  const errors: string[]=[];
  state.client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
    const response=await fetch(input,init);if(!response.ok&&String(input).includes('/rest/v1/'))errors.push(new URL(String(input)).pathname+':'+await response.clone().text());return response;
  }}});
  try {
    expect((await state.client.auth.signInWithPassword(loadFixedAccount("admin")!)).error).toBeNull();
    const marked=await state.client.from('profiles').select('id').eq('purpose','test');expect(marked.error).toBeNull();expect(marked.data!.length).toBeGreaterThan(0);
    const counted=await state.client.from('statistics_profiles').select('id');expect(counted.error).toBeNull();
    expect(counted.data!.some(row=>marked.data!.some(test=>test.id===row.id))).toBe(false);
    const overview=await getStaffOverviewData({grain:'month',date:'2026-09-01',now:new Date('2026-09-21T12:00:00Z')});
    const reads=await Promise.allSettled([getStaffStats(),getFollowUpFunnel(),getFinanceOverview(),getRosterMismatchCount(),
      getManagementAnalyticsData({grain:'month',sourceAccess:{leadFacts:true,activityFacts:true,classAttendanceFacts:true}}),
      listStaffMembers(),listStaffRoles(),countPendingRefunds()]);
    fs.writeFileSync(root+'/http-errors.private.json',JSON.stringify(errors));
    expect(reads.every(result=>result.status==='fulfilled')).toBe(true);
    expect(errors).toEqual([]);expect(overview.unavailableSources).toEqual([]);
    fs.writeFileSync(root+'/http.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:true,unavailable:overview.unavailableSources,testProfiles:marked.data!.length}));
  }finally{await state.client.auth.signOut({scope:'local'});}
},90_000);
