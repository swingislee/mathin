"use client";

import {
  STORE_BOARD_CHECKPOINTS,
  STORE_BOARD_MUTATION_JOURNALS,
  STORE_META,
  idbGet,
  idbListByIndex,
  openClassroomDb,
} from "../sync/idb";
import { boardMutationJournalKey, type BoardMutationJournal } from "./journal";
import type { PendingBoardCheckpoint } from "./types";

export function checkpointStoreKey(sessionId: string, boardKey: string, scope: "formal" | "rehearsal"): string {
  return `${sessionId}:${scope}:${boardKey}`;
}

function writerSeqKey(sessionId: string, boardKey: string, writerId: string, scope: "formal" | "rehearsal"): string {
  return `checkpoint:${sessionId}:${scope}:${boardKey}:${writerId}`;
}

/** Atomically advances writer seq and overwrites the same board's pending checkpoint. */
export async function enqueueLatestBoardCheckpoint(
  checkpoint: Omit<PendingBoardCheckpoint, "writerSeq">,
): Promise<PendingBoardCheckpoint> {
  const db = await openClassroomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_META, STORE_BOARD_CHECKPOINTS, STORE_BOARD_MUTATION_JOURNALS], "readwrite");
    const meta = tx.objectStore(STORE_META);
    const checkpoints = tx.objectStore(STORE_BOARD_CHECKPOINTS);
    const journals = tx.objectStore(STORE_BOARD_MUTATION_JOURNALS);
    const seqKey = writerSeqKey(checkpoint.sessionId, checkpoint.boardKey, checkpoint.writerId, checkpoint.scope);
    const journalKey = boardMutationJournalKey(checkpoint.sessionId, checkpoint.boardKey, checkpoint.scope);
    const journalSeq = Number.isSafeInteger(checkpoint.journalSeq) && Number(checkpoint.journalSeq) > 0
      ? Number(checkpoint.journalSeq)
      : 0;
    const getRequest = meta.get(seqKey) as IDBRequest<number | undefined>;
    const getJournalRequest = journals.get(journalKey) as IDBRequest<BoardMutationJournal | undefined>;
    let record: PendingBoardCheckpoint | null = null;
    let failure: Error | null = null;

    getRequest.onsuccess = () => {
      const writerSeq = Math.max(0, Number(getRequest.result) || 0) + 1;
      record = { ...checkpoint, journalSeq, writerSeq };
      meta.put(writerSeq, seqKey);
      checkpoints.put(record, checkpointStoreKey(checkpoint.sessionId, checkpoint.boardKey, checkpoint.scope));
    };
    getRequest.onerror = () => tx.abort();
    getJournalRequest.onsuccess = () => {
      try {
        const current = getJournalRequest.result;
        if (current && (current.sessionId !== checkpoint.sessionId
          || current.boardKey !== checkpoint.boardKey
          || current.scope !== checkpoint.scope)) {
          throw new Error("BOARD_MUTATION_JOURNAL_IDENTITY_MISMATCH");
        }
        journals.put({
          sessionId: checkpoint.sessionId,
          boardKey: checkpoint.boardKey,
          scope: checkpoint.scope,
          latestSeq: Math.max(journalSeq, current?.latestSeq ?? 0),
          entries: (current?.entries ?? []).filter((entry) => entry.seq > journalSeq),
        } satisfies BoardMutationJournal, journalKey);
      } catch (error) {
        failure = error instanceof Error ? error : new Error("BOARD_MUTATION_JOURNAL_COMPACT_FAILED");
        tx.abort();
      }
    };
    getJournalRequest.onerror = () => tx.abort();
    tx.oncomplete = () => record ? resolve(record) : reject(new Error("CHECKPOINT_OUTBOX_WRITE_FAILED"));
    tx.onerror = () => reject(failure ?? tx.error ?? new Error("CHECKPOINT_OUTBOX_WRITE_FAILED"));
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("CHECKPOINT_OUTBOX_WRITE_ABORTED"));
  });
}

export function getPendingBoardCheckpoint(
  sessionId: string,
  boardKey: string,
  scope: "formal" | "rehearsal",
): Promise<PendingBoardCheckpoint | undefined> {
  return idbGet<PendingBoardCheckpoint>(STORE_BOARD_CHECKPOINTS, checkpointStoreKey(sessionId, boardKey, scope));
}

export async function listPendingBoardCheckpoints(
  sessionId: string,
  scope: "formal" | "rehearsal" = "formal",
): Promise<PendingBoardCheckpoint[]> {
  const checkpoints = await idbListByIndex<PendingBoardCheckpoint>(STORE_BOARD_CHECKPOINTS, "sessionId", sessionId);
  return checkpoints.filter((checkpoint) => checkpoint.scope === scope);
}

/** Deletes only the acknowledged record; a newer overwrite survives an older request finishing. */
export async function deletePendingBoardCheckpointIfCurrent(
  sessionId: string,
  boardKey: string,
  checkpointId: string,
  scope: "formal" | "rehearsal",
): Promise<boolean> {
  const db = await openClassroomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_BOARD_CHECKPOINTS, "readwrite");
    const store = tx.objectStore(STORE_BOARD_CHECKPOINTS);
    const key = checkpointStoreKey(sessionId, boardKey, scope);
    const request = store.get(key) as IDBRequest<PendingBoardCheckpoint | undefined>;
    let deleted = false;
    request.onsuccess = () => {
      if (request.result?.checkpointId === checkpointId) {
        store.delete(key);
        deleted = true;
      }
    };
    request.onerror = () => tx.abort();
    tx.oncomplete = () => resolve(deleted);
    tx.onerror = () => reject(tx.error ?? new Error("CHECKPOINT_OUTBOX_DELETE_FAILED"));
    tx.onabort = () => reject(tx.error ?? new Error("CHECKPOINT_OUTBOX_DELETE_ABORTED"));
  });
}
