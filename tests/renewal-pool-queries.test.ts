import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { loadRenewalPoolSupplement } from "@/features/school/renewal-pool-data";
import type { RenewalWorkspaceData } from "@/features/school/renewals";

function setup(admin: boolean) {
  let active = 0; let peak = 0; let checks = 0;
  const reads: string[] = [];
  const memberships = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, classroom_id: `c${i}`, status: i === 0 ? "left" : i === 1 ? "completed" : "active" }));
  const rpc = vi.fn(async (name: string, args?: { cid: string; uid: string }) => {
    if (name === "is_admin") return { data: admin, error: null };
    if (name === "get_renewal_health_facts") return { data: [], error: null };
    if (name === "is_classroom_teacher") {
      checks++; active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      expect(args?.uid).toBe("actor");
      return { data: ["c0", "c1", "c2"].includes(args!.cid), error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  mocks.createClient.mockResolvedValue({ rpc, from: (table: string) => {
    const api = { select: () => api, in: () => api, eq: () => api, order: () => api,
      range: async () => { reads.push(table); return { data: table === "enrollments" ? memberships : [], error: null }; } };
    return api;
  } });
  const workspace = { selectedCycleId: null, opportunities: [], candidates: memberships.map(m => ({ membershipId: m.id, studentId: "student" })) } as unknown as RenewalWorkspaceData;
  return { workspace, rpc, reads, stats: () => ({ peak, checks }) };
}

describe("renewal pool authorization reads", () => {
  it("avoids per-class teacher checks for an administrator while retaining membership eligibility", async () => {
    const state = setup(true);
    const result = await loadRenewalPoolSupplement(state.workspace, "actor");
    expect(state.stats().checks).toBe(0);
    expect(result.observationMemberships).toEqual(Array.from({ length: 8 }, (_, i) => `m${i + 1}`));
  });
  it("keeps each non-administrator class check and caps concurrency at four", async () => {
    const state = setup(false);
    const result = await loadRenewalPoolSupplement(state.workspace, "actor");
    expect(state.stats()).toEqual({ checks: 9, peak: 4 });
    expect(result.observationMemberships).toEqual(["m1", "m2"]);
  });

  it("starts independent student and membership reads while health facts are still pending", async () => {
    const state = setup(true);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    state.rpc.mockImplementation(async name => {
      if (name === "get_renewal_health_facts") { await gate; return { data: [], error: null }; }
      return { data: true, error: null };
    });
    const pending = loadRenewalPoolSupplement(state.workspace, "actor");
    await vi.waitFor(() => expect(state.reads).toEqual(expect.arrayContaining(["students", "enrollments", "teacher_professional_signals"])));
    release();
    expect((await pending).healthAvailable).toBe(true);
  });

  it("keeps complete signals across result pages and ID batches, in descending time order", async () => {
    const ids = Array.from({ length: 161 }, (_, i) => `s${i}`);
    const signals = Array.from({ length: 1025 }, (_, i) => ({ student_id: "s0", source_class_membership_id: "m0", recommendation: String(i), occurred_at: new Date(i * 1000).toISOString() }));
    signals.push({ student_id: "s160", source_class_membership_id: "m160", recommendation: "last batch", occurred_at: new Date(2_000_000).toISOString() });
    const reads: {table:string;size:number;start:number}[] = [];
    mocks.createClient.mockResolvedValue({ rpc: async (name:string) => ({ data: name === "is_admin" ? true : [], error: null }), from: (table:string) => {
      let batch:string[] = [];
      const query = { select: () => query, in: (_:string, values:string[]) => { batch=values; return query; }, order: () => query,
        range: async (start:number,end:number) => {
          reads.push({table,size:batch.length,start});
          const values = table === "teacher_professional_signals" ? signals.filter(row=>batch.includes(row.student_id)).toSorted((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at))
            : table === "students" ? batch.map(id=>({id,phone:""})) : [];
          return {data:values.slice(start,end+1),error:null};
        } };
      return query;
    }});
    const workspace = { selectedCycleId:null, opportunities:[], candidates:ids.map(studentId=>({studentId,membershipId:`m${studentId}`})) } as unknown as RenewalWorkspaceData;
    const result = await loadRenewalPoolSupplement(workspace,"actor");
    expect(result.students).toHaveLength(161);
    expect(result.signals).toHaveLength(1026);
    expect(result.signals[0].recommendation).toBe("last batch");
    expect(result.signals.at(-1)?.recommendation).toBe("0");
    expect(reads.every(read=>read.size<=80)).toBe(true);
    expect(reads).toContainEqual({table:"teacher_professional_signals",size:80,start:1000});
  });

  it("propagates a later result page failure instead of returning a partial signal history", async () => {
    const state = setup(true);
    const client = await mocks.createClient();
    const originalFrom = client.from;
    client.from = (table:string) => {
      if(table!=="teacher_professional_signals")return originalFrom(table);
      const query = {select:()=>query,in:()=>query,order:()=>query,
        range:async(start:number)=>start===0?{data:Array.from({length:1000},()=>({})),error:null}:{data:null,error:{message:"signals unavailable"}}};
      return query;
    };
    await expect(loadRenewalPoolSupplement(state.workspace,"actor")).rejects.toThrow("signals unavailable");
  });
});
