import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectPostgrestRowsInBatches,
  POSTGREST_FILTER_BATCH_SIZE,
  postgrestFilterBatches,
} from "../src/lib/supabase/postgrest-batches";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("PostgREST filter hardening", () => {
  it("keeps every generated filter batch below the shared URI-safe limit", () => {
    const values = Array.from({ length: 500 }, (_, index) => `id-${index}`);
    const batches = postgrestFilterBatches(values);

    expect(batches).toHaveLength(13);
    expect(batches.every((batch) => batch.length <= POSTGREST_FILTER_BATCH_SIZE)).toBe(true);
    expect(batches.flat()).toEqual(values);
  });

  it("merges rows in input batch order and stops on a PostgREST error", async () => {
    const loadBatch = vi.fn(async (batch: number[]) => ({
      data: batch.map((value) => ({ value })),
      error: null,
    }));

    await expect(collectPostgrestRowsInBatches(
      Array.from({ length: 85 }, (_, index) => index),
      loadBatch,
    )).resolves.toEqual(Array.from({ length: 85 }, (_, value) => ({ value })));
    expect(loadBatch.mock.calls.map(([batch]) => batch.length)).toEqual([40, 40, 5]);

    await expect(collectPostgrestRowsInBatches([1], async () => ({
      data: null,
      error: { message: "BROKEN_QUERY" },
    }))).rejects.toThrow("BROKEN_QUERY");
  });

  it("caps parallel batch requests", async () => {
    let active = 0;
    let maxActive = 0;

    await collectPostgrestRowsInBatches(
      Array.from({ length: 200 }, (_, index) => index),
      async (batch) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return { data: batch, error: null };
      },
    );

    expect(maxActive).toBe(4);
  });

  it("routes unbounded aggregation and subtree writes through shared batches", () => {
    const followups = read("src", "features", "school", "followups.ts");
    const notebook = read("src", "features", "notebook", "actions.ts");

    expect(followups).toContain("collectPostgrestRowsInBatches");
    expect(notebook).toContain("collectPostgrestRowsInBatches");
    expect(followups).not.toContain('.in("student_id", studentIds)');
    expect(notebook).not.toContain('.in("id", [...subtree])');
    expect(notebook).not.toContain('.in("note_id", [...subtree])');
  });
});
