import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { assessmentReadFrom, readAllAssessmentRows, readRelatedAssessmentRows } from "@/features/school/assessment-workbench-read";

vi.mock("server-only", () => ({}));

function fixture(rows: Array<{ id: string; parent_id: string }>, failParent?: string) {
  let active = 0, maximum = 0;
  const reads: Array<{ offset: number; limit: number; order: string; keys: string[] }> = [];
  const client = createClient("https://fixture.example.test", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async input => {
      const url=new URL(String(input));
      const keys=url.searchParams.get("parent_id")?.slice(4,-1).split(",")??[];
      const offset=Number(url.searchParams.get("offset")??0), limit=Number(url.searchParams.get("limit")??1000);
      reads.push({offset,limit,order:url.searchParams.get("order")??"",keys});
      active++;maximum=Math.max(maximum,active);
      await new Promise(resolve=>setTimeout(resolve,keys.includes("p0")?8:1));
      active--;
      if(failParent && keys.includes(failParent)) return Response.json({message:"permission denied"},{status:403});
      const visible=rows.filter(row=>!keys.length||keys.includes(row.parent_id));
      return Response.json(visible.slice(offset,offset+limit));
    } },
  });
  return {client,reads,concurrency:()=>({active,maximum})};
}

describe("assessment workbench complete batch reads",()=>{
  it("reads past 1000 rows and preserves the business ordering before the id tie-breaker",async()=>{
    const rows=Array.from({length:2001},(_,i)=>({id:`r${i}`,parent_id:"p0"}));
    const sample=fixture(rows);
    expect((await readAllAssessmentRows(()=>assessmentReadFrom(sample.client)("rows").select("*").order("assessment_at",{ascending:false,nullsFirst:false}))).data).toEqual(rows);
    expect(sample.reads.map(read=>[read.offset,read.limit])).toEqual([[0,1000],[1000,1000],[2000,1000]]);
    expect(sample.reads.every(read=>read.order==="assessment_at.desc.nullslast,id.asc")).toBe(true);
  });

  it("reads a final empty page for an exact boundary",async()=>{
    const rows=Array.from({length:1000},(_,i)=>({id:`r${i}`,parent_id:"p0"}));
    const sample=fixture(rows);
    expect((await readAllAssessmentRows(()=>assessmentReadFrom(sample.client)("rows").select("*"))).data).toEqual(rows);
    expect(sample.reads.map(read=>read.offset)).toEqual([0,1000]);
  });

  it("deduplicates input keys, bounds concurrency and keeps batch order despite out-of-order completion",async()=>{
    const rows=Array.from({length:401},(_,i)=>({id:`r${i}`,parent_id:`p${i}`}));
    const sample=fixture(rows);
    const ids=rows.map(row=>row.parent_id);
    expect((await readRelatedAssessmentRows(sample.client,"rows","*","parent_id",[...ids,...ids])).data).toEqual(rows);
    expect(sample.concurrency()).toEqual({active:0,maximum:4});
    expect(sample.reads).toHaveLength(6);
    expect(sample.reads.every(read=>read.keys.length<=80)).toBe(true);
  });

  it("reads every page within a related batch and avoids requests for an empty scope",async()=>{
    const rows=Array.from({length:1001},(_,i)=>({id:`r${i}`,parent_id:"p0"}));
    const sample=fixture(rows);
    expect((await readRelatedAssessmentRows(sample.client,"rows","*","parent_id",[])).data).toEqual([]);
    expect(sample.reads).toHaveLength(0);
    expect((await readRelatedAssessmentRows(sample.client,"rows","*","parent_id",["p0"])).data).toEqual(rows);
    expect(sample.reads.map(read=>read.offset)).toEqual([0,1000]);
  });

  it("discards partial data and finishes in-flight reads before returning a failed batch",async()=>{
    const rows=Array.from({length:401},(_,i)=>({id:`r${i}`,parent_id:`p${i}`}));
    const sample=fixture(rows,"p80");
    expect(await readRelatedAssessmentRows(sample.client,"rows","*","parent_id",rows.map(row=>row.parent_id))).toEqual({data:null,error:expect.objectContaining({message:"permission denied"})});
    expect(sample.reads).toHaveLength(4);
    expect(sample.concurrency().active).toBe(0);
  });
});
