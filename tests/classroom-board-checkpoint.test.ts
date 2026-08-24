import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBoardCheckpoint,
  CHECKPOINT_CHUNK_TARGET_BYTES,
  CHECKPOINT_WARNING_BYTES,
  resampleStrokePoints,
  utf8JsonBytes,
} from "@/features/classroom/checkpoint/codec";
import {
  deletePendingBoardCheckpointIfCurrent,
  enqueueLatestBoardCheckpoint,
  getPendingBoardCheckpoint,
} from "@/features/classroom/checkpoint/outbox";
import {
  appendBoardMutationJournal,
  applyBoardMutationJournal,
  getBoardMutationJournal,
} from "@/features/classroom/checkpoint/journal";
import { parseSessionBoardCheckpoints } from "@/features/classroom/checkpoint/parse";
import { BoardCheckpointPreparer } from "@/features/classroom/checkpoint/preparer";
import { shouldApplyLegacyBoardSnapshot } from "@/features/classroom/checkpoint/selection";
import { createM2AcceptanceStrokes } from "@/features/classroom/live/m2-acceptance-fixture";
import type { StrokeItem } from "@/features/whiteboard/types";

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("classroom board checkpoint v2", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps endpoints while adaptively resampling one oversized stroke", () => {
    const points = Array.from({ length: 4000 }, (_, index): [number, number] => {
      const coordinate = -0.499999999999999 + index * (0.399999999999998 / 3999);
      return [coordinate, coordinate * 0.999999999999997];
    });
    const reduced = resampleStrokePoints(points, 0.00015);
    expect(reduced[0]).toEqual(points[0]);
    expect(reduced.at(-1)).toEqual(points.at(-1));

    const stroke: StrokeItem = { id: "dense-stroke", mode: "ink", color: "ink", wNorm: 0.004, points };
    const prepared = buildBoardCheckpoint([stroke]);
    expect(prepared.resampled).toBe(true);
    expect(prepared.storedPointCount).toBeLessThan(prepared.originalPointCount);
    expect(prepared.chunks[0][0]).toMatchObject({ id: stroke.id });
    expect((prepared.chunks[0][0] as StrokeItem).points[0]).toEqual(points[0]);
    expect((prepared.chunks[0][0] as StrokeItem).points.at(-1)).toEqual(points.at(-1));
  });

  it("builds the 500-stroke acceptance fixture at item boundaries under the frozen budgets", () => {
    const strokes = createM2AcceptanceStrokes();
    const prepared = buildBoardCheckpoint(strokes);
    expect(prepared.itemCount).toBe(500);
    expect(prepared.chunks.flat()).toHaveLength(500);
    expect(prepared.chunks.length).toBeGreaterThan(1);
    expect(prepared.chunks.length).toBeLessThanOrEqual(64);
    expect(prepared.chunks.every((chunk) => utf8JsonBytes(chunk) <= CHECKPOINT_CHUNK_TARGET_BYTES)).toBe(true);
    expect(prepared.contentBytes).toBeLessThan(CHECKPOINT_WARNING_BYTES);
    expect((prepared.chunks.flat().at(-1) as StrokeItem).id).toBe("m2-fixture-500");
  });

  it("overwrites only the same board and scope, and cannot delete a newer pending version", async () => {
    const sessionId = crypto.randomUUID();
    const writerId = crypto.randomUUID();
    const boardKey = "side";
    const prepared = buildBoardCheckpoint([createM2AcceptanceStrokes(1)[0]]);
    const base = {
      ...prepared,
      sessionId,
      boardKey,
      writerId,
      baseVersion: 0,
      sourceRevision: 1,
      preparedAt: new Date().toISOString(),
    };
    const first = await enqueueLatestBoardCheckpoint({
      ...base,
      scope: "formal",
      checkpointId: crypto.randomUUID(),
    });
    const second = await enqueueLatestBoardCheckpoint({
      ...base,
      scope: "formal",
      checkpointId: crypto.randomUUID(),
      sourceRevision: 2,
    });
    const rehearsal = await enqueueLatestBoardCheckpoint({
      ...base,
      scope: "rehearsal",
      checkpointId: crypto.randomUUID(),
    });

    expect(second.writerSeq).toBe(first.writerSeq + 1);
    expect(rehearsal.writerSeq).toBe(1);
    expect((await getPendingBoardCheckpoint(sessionId, boardKey, "formal"))?.checkpointId).toBe(second.checkpointId);
    expect((await getPendingBoardCheckpoint(sessionId, boardKey, "rehearsal"))?.checkpointId).toBe(rehearsal.checkpointId);
    await expect(deletePendingBoardCheckpointIfCurrent(sessionId, boardKey, first.checkpointId, "formal")).resolves.toBe(false);
    await expect(deletePendingBoardCheckpointIfCurrent(sessionId, boardKey, second.checkpointId, "formal")).resolves.toBe(true);
    expect(await getPendingBoardCheckpoint(sessionId, boardKey, "formal")).toBeUndefined();
    expect(await getPendingBoardCheckpoint(sessionId, boardKey, "rehearsal")).toBeDefined();
  });

  it("keeps the rewritten main board as the latest local checkpoint after a clear", async () => {
    const sessionId = crypto.randomUUID();
    const writerId = crypto.randomUUID();
    const boardKey = crypto.randomUUID();
    const empty = buildBoardCheckpoint([]);
    await enqueueLatestBoardCheckpoint({
      ...empty,
      scope: "rehearsal",
      checkpointId: crypto.randomUUID(),
      sessionId,
      boardKey,
      writerId,
      baseVersion: 0,
      sourceRevision: 1,
      preparedAt: new Date().toISOString(),
    });

    const rewritten = buildBoardCheckpoint(createM2AcceptanceStrokes(1));
    const latest = await enqueueLatestBoardCheckpoint({
      ...rewritten,
      scope: "rehearsal",
      checkpointId: crypto.randomUUID(),
      sessionId,
      boardKey,
      writerId,
      baseVersion: 0,
      sourceRevision: 2,
      preparedAt: new Date().toISOString(),
    });

    const recovered = await getPendingBoardCheckpoint(sessionId, boardKey, "rehearsal");
    expect(recovered?.checkpointId).toBe(latest.checkpointId);
    expect(recovered?.sourceRevision).toBe(2);
    expect(recovered?.itemCount).toBe(1);
    expect((recovered?.chunks.flat()[0] as StrokeItem).id).toBe("m2-fixture-1");
  });

  it("recovers a final stroke from the durable mutation journal before the debounce checkpoint", async () => {
    const sessionId = crypto.randomUUID();
    const boardKey = crypto.randomUUID();
    const [baseStroke, finalStroke] = createM2AcceptanceStrokes(2);
    const seq = await appendBoardMutationJournal({
      sessionId,
      boardKey,
      scope: "rehearsal",
      ops: [{ t: "commit", item: finalStroke }],
    });

    const journal = await getBoardMutationJournal(sessionId, boardKey, "rehearsal");
    expect(seq).toBe(1);
    expect(journal?.latestSeq).toBe(1);
    expect(applyBoardMutationJournal([baseStroke], journal).map((item) => item.id)).toEqual([
      baseStroke.id,
      finalStroke.id,
    ]);
  });

  it("replays clear then rewrite and only compacts the journal prefix covered by a checkpoint", async () => {
    const sessionId = crypto.randomUUID();
    const boardKey = crypto.randomUUID();
    const writerId = crypto.randomUUID();
    const [oldStroke, rewrittenStroke, laterStroke] = createM2AcceptanceStrokes(3);
    const clearSeq = await appendBoardMutationJournal({
      sessionId,
      boardKey,
      scope: "rehearsal",
      ops: [{ t: "clear" }, { t: "restore", items: [rewrittenStroke] }],
    });
    const laterSeq = await appendBoardMutationJournal({
      sessionId,
      boardKey,
      scope: "rehearsal",
      ops: [{ t: "commit", item: laterStroke }],
    });
    const beforeCheckpoint = await getBoardMutationJournal(sessionId, boardKey, "rehearsal");
    expect(applyBoardMutationJournal([oldStroke], beforeCheckpoint).map((item) => item.id)).toEqual([
      rewrittenStroke.id,
      laterStroke.id,
    ]);

    const prepared = buildBoardCheckpoint([rewrittenStroke]);
    const pending = await enqueueLatestBoardCheckpoint({
      ...prepared,
      scope: "rehearsal",
      checkpointId: crypto.randomUUID(),
      sessionId,
      boardKey,
      writerId,
      baseVersion: 0,
      sourceRevision: 1,
      journalSeq: clearSeq,
      preparedAt: new Date().toISOString(),
    });
    const compacted = await getBoardMutationJournal(sessionId, boardKey, "rehearsal");
    expect(compacted?.latestSeq).toBe(laterSeq);
    expect(compacted?.entries.map((entry) => entry.seq)).toEqual([laterSeq]);
    expect(applyBoardMutationJournal(
      pending.chunks.flat(),
      compacted,
      pending.journalSeq,
    ).map((item) => item.id)).toEqual([rewrittenStroke.id, laterStroke.id]);
  });

  it("terminates stale Worker work and only resolves the latest task", async () => {
    class WorkerMock {
      static instances: WorkerMock[] = [];
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      message: { taskId: number } | null = null;
      terminated = false;

      constructor() {
        WorkerMock.instances.push(this);
      }

      postMessage(message: { taskId: number }) {
        this.message = message;
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", WorkerMock);
    const preparer = new BoardCheckpointPreparer();
    const strokes = createM2AcceptanceStrokes(1);
    const prepared = buildBoardCheckpoint(strokes);
    const first = preparer.prepare(strokes);
    const second = preparer.prepare(strokes);

    await expect(first).resolves.toBeNull();
    expect(WorkerMock.instances[0].terminated).toBe(true);
    expect(WorkerMock.instances).toHaveLength(2);
    const active = WorkerMock.instances[1];
    active.onmessage?.({
      data: { taskId: active.message?.taskId, ok: true, result: prepared },
    } as MessageEvent);
    await expect(second).resolves.toEqual(prepared);
    preparer.close();
    expect(active.terminated).toBe(true);
  });

  it("rejects a checkpoint whose manifest or board item shape is invalid", () => {
    const item = createM2AcceptanceStrokes(1)[0];
    const valid = {
      boardKey: "side",
      version: 1,
      checkpointId: crypto.randomUUID(),
      createdAt: "2026-08-24T00:00:00.000Z",
      itemCount: 1,
      chunkCount: 1,
      contentBytes: utf8JsonBytes([item]),
      items: [item],
    };
    expect(parseSessionBoardCheckpoints([valid])[0].items).toEqual([item]);
    expect(() => parseSessionBoardCheckpoints([{ ...valid, itemCount: 2 }])).toThrow("CHECKPOINT_RESPONSE_INVALID");
    expect(() => parseSessionBoardCheckpoints([{
      ...valid,
      items: [{ ...item, points: [[Number.NaN, 0]] }],
    }])).toThrow("CHECKPOINT_ITEMS_INVALID");
    const checkpoint = parseSessionBoardCheckpoints([valid])[0];
    expect(shouldApplyLegacyBoardSnapshot(checkpoint, "2026-08-23T23:59:59.000Z")).toBe(false);
    expect(shouldApplyLegacyBoardSnapshot(checkpoint, "2026-08-25T00:00:00.000Z")).toBe(true);
    expect(shouldApplyLegacyBoardSnapshot(checkpoint, undefined)).toBe(false);
  });

  it("keeps the database writer fail-closed and latest-only while legacy reads remain available", () => {
    const migration = source("supabase/migrations/20260824000100_classroom_board_checkpoints.sql");
    const actions = source("src/features/classroom/actions.ts");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("octet_length(chunk_value::text) > 196608");
    expect(migration).toContain("jsonb_array_length(p_chunks) not between 1 and 64");
    expect(migration).toContain("p_base_version is null or p_base_version < 0");
    expect(migration).toContain("p_item_count not between 0 and 4000");
    expect(migration).toMatch(/delete from public\.session_board_checkpoint_versions[\s\S]*version < next_version/);
    expect(migration).toContain("session_board_checkpoint_versions_rpc_only");
    expect(migration).toContain("'teaching.classroom_board_checkpoint_v2', 1, false");
    expect(migration).toContain("get_session_legacy_board_snapshots");
    expect(migration).toMatch(/order by event_row\.payload ->> 'pageKey', event_row\.created_at desc, event_row\.id desc/);
    expect(actions).toContain('.neq("type", "board_snapshot")');
    expect(actions).toContain('.order("created_at", { ascending: true })');
    expect(actions).toContain("get_session_board_checkpoints");
  });

  it("fences stale Worker results and reloads the active board only after an explicit local flush", () => {
    const hook = source("src/features/classroom/live/useClassBoard.ts");
    const shell = source("src/features/classroom/live/LiveShell.tsx");
    expect(hook).toContain('state: "dirty"');
    expect(hook).toContain("sourceRevision !== latestTaskRevision");
    expect(hook).toContain("flushLatestCheckpoint");
    expect(hook).toContain("appendBoardMutationJournal");
    expect(hook).toContain("journalSeq");
    expect(shell).toContain('const activeBoardKey = activeArea === "side" ? "side" : activePage?.id ?? null');
    expect(shell).toContain("await sideBoard.flushCheckpoint()");
    expect(shell).toContain("await mainCheckpointControl.flush()");
    expect(shell).not.toContain("const sideCheckpointStatus =");
  });
});
