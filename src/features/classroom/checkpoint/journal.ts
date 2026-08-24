"use client";

import type { BoardItem, BoardOp } from "@/features/whiteboard/types";
import { STORE_BOARD_MUTATION_JOURNALS, idbGet, openClassroomDb } from "../sync/idb";
import { parseBoardItems } from "./parse";

export const BOARD_MUTATION_JOURNAL_MAX_ENTRIES = 2048;

export interface BoardMutationJournalEntry {
  seq: number;
  ops: BoardOp[];
}

export interface BoardMutationJournal {
  sessionId: string;
  boardKey: string;
  scope: "formal" | "rehearsal";
  latestSeq: number;
  entries: BoardMutationJournalEntry[];
}

export function boardMutationJournalKey(
  sessionId: string,
  boardKey: string,
  scope: "formal" | "rehearsal",
): string {
  return `${sessionId}:${scope}:${boardKey}`;
}

function parseBoardOps(value: unknown): BoardOp[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4001) {
    throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
    }
    const op = candidate as Record<string, unknown>;
    if (op.t === "clear") return { t: "clear" };
    if (op.t === "erase" && typeof op.id === "string" && op.id.length >= 1 && op.id.length <= 64) {
      return { t: "erase", id: op.id };
    }
    if ((op.t === "commit" || op.t === "replace") && op.item) {
      const [item] = parseBoardItems([op.item]);
      return { t: op.t, item };
    }
    if (op.t === "restore") {
      const items = parseBoardItems(op.items);
      return { t: "restore", items };
    }
    throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
  });
}

function parseBoardMutationJournal(value: unknown): BoardMutationJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
  }
  const row = value as Record<string, unknown>;
  const latestSeq = Number(row.latestSeq);
  if (typeof row.sessionId !== "string" || !row.sessionId
    || typeof row.boardKey !== "string" || !row.boardKey
    || (row.scope !== "formal" && row.scope !== "rehearsal")
    || !Number.isSafeInteger(latestSeq) || latestSeq < 0
    || !Array.isArray(row.entries) || row.entries.length > BOARD_MUTATION_JOURNAL_MAX_ENTRIES) {
    throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
  }
  let previousSeq = 0;
  const entries = row.entries.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
    }
    const entry = candidate as Record<string, unknown>;
    const seq = Number(entry.seq);
    if (!Number.isSafeInteger(seq) || seq <= previousSeq || seq > latestSeq) {
      throw new Error("BOARD_MUTATION_JOURNAL_INVALID");
    }
    previousSeq = seq;
    return { seq, ops: parseBoardOps(entry.ops) };
  });
  return {
    sessionId: row.sessionId,
    boardKey: row.boardKey,
    scope: row.scope,
    latestSeq,
    entries,
  };
}

export async function appendBoardMutationJournal(input: {
  sessionId: string;
  boardKey: string;
  scope: "formal" | "rehearsal";
  ops: BoardOp[];
}): Promise<number> {
  const ops = parseBoardOps(input.ops);
  const db = await openClassroomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOARD_MUTATION_JOURNALS, "readwrite");
    const store = tx.objectStore(STORE_BOARD_MUTATION_JOURNALS);
    const key = boardMutationJournalKey(input.sessionId, input.boardKey, input.scope);
    const request = store.get(key) as IDBRequest<BoardMutationJournal | undefined>;
    let nextSeq = 0;
    let failure: Error | null = null;

    request.onsuccess = () => {
      try {
        const current = request.result ? parseBoardMutationJournal(request.result) : {
          sessionId: input.sessionId,
          boardKey: input.boardKey,
          scope: input.scope,
          latestSeq: 0,
          entries: [],
        } satisfies BoardMutationJournal;
        if (current.sessionId !== input.sessionId || current.boardKey !== input.boardKey || current.scope !== input.scope) {
          throw new Error("BOARD_MUTATION_JOURNAL_IDENTITY_MISMATCH");
        }
        if (current.entries.length >= BOARD_MUTATION_JOURNAL_MAX_ENTRIES) {
          throw new Error("BOARD_MUTATION_JOURNAL_FULL");
        }
        nextSeq = current.latestSeq + 1;
        store.put({
          ...current,
          latestSeq: nextSeq,
          entries: [...current.entries, { seq: nextSeq, ops }],
        } satisfies BoardMutationJournal, key);
      } catch (error) {
        failure = error instanceof Error ? error : new Error("BOARD_MUTATION_JOURNAL_WRITE_FAILED");
        tx.abort();
      }
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve(nextSeq);
    tx.onerror = () => reject(failure ?? tx.error ?? new Error("BOARD_MUTATION_JOURNAL_WRITE_FAILED"));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("BOARD_MUTATION_JOURNAL_WRITE_ABORTED"));
  });
}

export async function getBoardMutationJournal(
  sessionId: string,
  boardKey: string,
  scope: "formal" | "rehearsal",
): Promise<BoardMutationJournal | undefined> {
  const value = await idbGet<BoardMutationJournal>(
    STORE_BOARD_MUTATION_JOURNALS,
    boardMutationJournalKey(sessionId, boardKey, scope),
  );
  if (!value) return undefined;
  const journal = parseBoardMutationJournal(value);
  if (journal.sessionId !== sessionId || journal.boardKey !== boardKey || journal.scope !== scope) {
    throw new Error("BOARD_MUTATION_JOURNAL_IDENTITY_MISMATCH");
  }
  return journal;
}

export function applyBoardMutationJournal(
  baseItems: BoardItem[],
  journal: BoardMutationJournal | undefined,
  afterSeq = 0,
): BoardItem[] {
  let items = [...parseBoardItems(baseItems)];
  for (const entry of journal?.entries ?? []) {
    if (entry.seq <= afterSeq) continue;
    for (const op of entry.ops) {
      if (op.t === "clear") {
        items = [];
        continue;
      }
      if (op.t === "erase") {
        items = items.filter((item) => item.id !== op.id);
        continue;
      }
      if (op.t === "commit") {
        if (!items.some((item) => item.id === op.item.id)) items = [...items, op.item];
        continue;
      }
      if (op.t === "replace") {
        const found = items.some((item) => item.id === op.item.id);
        items = found ? items.map((item) => item.id === op.item.id ? op.item : item) : [...items, op.item];
        continue;
      }
      const known = new Set(items.map((item) => item.id));
      const restored = op.items.filter((item) => !known.has(item.id));
      if (restored.length) items = [...items, ...restored];
    }
  }
  return items;
}
