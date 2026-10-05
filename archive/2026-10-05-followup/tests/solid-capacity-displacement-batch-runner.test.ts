import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync("scripts/prepared-tool-scenes-local.mjs", "utf8").replace(/^import .+;\r?\n/gm, "");
const batch = ["20260921130000_solid_curved_nets", "20260921140000_capacity_displacement", "20260921150000_solid_geometry_exploration", "20260921160000_solid_revolution", "20260921170000_spatial_teaching_batch"];
const hash = (file: string) => `hash:${file}`;
/** 仓库 SQL 只作为字符串传给内存替身，不连接数据库、不写文件。 */
function run(mode: string, increment: string, recorded: Record<string, string> = {}, previous?: unknown) {
  const queries: string[] = [], writes: unknown[] = [];
  const sql = (query: string) => {
    queries.push(query);
    if (query.includes("select checksum")) return recorded[query.match(/version='([^']+)'/)![1]] ?? "";
    if (query.includes("select md5")) return "same function fingerprint";
    if (query.includes("jsonb_build_object('pages'")) return "same business invariants";
    return "";
  };
  const fakeFs = {
    mkdirSync: () => {},
    readFileSync(file: string) {
      if (file.endsWith("check.json")) return JSON.stringify(previous);
      const filename = path.basename(file);
      return file.includes("migrations") ? `begin;\nselect '${filename}';\ncommit;\n` : "begin;\nselect 'assertions';\nrollback;\n";
    },
    writeFileSync(_file: string, value: string) { writes.push(JSON.parse(value)); },
  };
  vm.runInNewContext(source, { fs: fakeFs, path, textFileSha256: hash, openHistoryLocalTarget: () => ({ sql, observed: { host: "fake-local" } }),
    process: { argv: ["node", "runner", mode, increment], exit: () => {} }, console: { log: () => {} } });
  return { queries, writes };
}
describe("ordered local Tools batch runner without database access", () => {
  it("retains the single-migration path and its checksum format", () => {
    const result = run("--check", "net-pyramids");
    expect(result.writes[0]).toMatchObject({ checksum: hash("supabase/migrations/20260921120000_solid_net_pyramids.sql"), rollback: "PASS" });
    const transaction = result.queries.find((query) => query.startsWith("begin;"))!;
    expect(transaction).toContain("20260921120000_solid_net_pyramids.sql"); expect(transaction).toMatch(/rollback;$/);
  });
  it("checks all five migrations in order inside one rolled-back transaction", () => {
    const result = run("--check", "spatial-batch"), transactions = result.queries.filter((query) => query.startsWith("begin;"));
    expect(transactions).toHaveLength(1);
    const positions = batch.map((name) => transactions[0].indexOf(name));
    expect(positions.every((p, i) => p > 0 && (!i || p > positions[i - 1]))).toBe(true);
    expect(transactions[0]).not.toContain("insert into public.schema_migrations");
    expect(result.writes[0]).toMatchObject({ rollback: "PASS", contract: "PASS" });
  });
  it("applies pending migrations and their ledger entries atomically after a matching fresh check", () => {
    const checked = run("--check", "spatial-batch").writes[0];
    const result = run("--apply", "spatial-batch", {}, checked);
    const transactions = result.queries.filter((query) => query.startsWith("begin;")); expect(transactions).toHaveLength(1);
    for (const version of batch) expect(transactions[0]).toContain(`values('${version}','${hash(`supabase/migrations/${version}.sql`)}')`);
    expect(transactions[0]).toMatch(/commit;$/);
  });
  it("accepts an already-applied prefix but rejects gaps and checksum drift", () => {
    const prefix = { [batch[0]]: hash(`supabase/migrations/${batch[0]}.sql`) };
    const result = run("--check", "spatial-batch", prefix);
    const transaction = result.queries.find((query) => query.startsWith("begin;"))!;
    expect(transaction).not.toContain(batch[0]); expect(transaction).toContain(batch[1]);
    expect(() => run("--check", "spatial-batch", { [batch[1]]: hash(`supabase/migrations/${batch[1]}.sql`) })).toThrow("TOOL_SCENES_MIGRATION_ORDER_MISMATCH");
    expect(() => run("--check", "spatial-batch", { [batch[0]]: "different" })).toThrow("TOOL_SCENES_MIGRATION_CHECKSUM_MISMATCH");
  });
});
