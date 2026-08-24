"use client";

import type { BoardItem } from "@/features/whiteboard/types";
import type { PreparedBoardCheckpoint } from "./types";

interface WorkerResponse {
  taskId: number;
  ok: boolean;
  result?: PreparedBoardCheckpoint;
  error?: string;
}

interface PendingTask {
  taskId: number;
  resolve: (result: PreparedBoardCheckpoint | null) => void;
  reject: (error: Error) => void;
}

/** One coordinator per board. A newer request terminates stale CPU work. */
export class BoardCheckpointPreparer {
  private worker: Worker | null = null;
  private nextTaskId = 1;
  private pending: PendingTask | null = null;

  prepare(items: BoardItem[]): Promise<PreparedBoardCheckpoint | null> {
    if (typeof Worker === "undefined") return Promise.reject(new Error("CHECKPOINT_WORKER_UNAVAILABLE"));
    if (this.pending) {
      this.pending.resolve(null);
      this.pending = null;
      this.worker?.terminate();
      this.worker = null;
    }
    const worker = this.ensureWorker();
    const taskId = this.nextTaskId++;
    return new Promise((resolve, reject) => {
      this.pending = { taskId, resolve, reject };
      worker.postMessage({ taskId, items });
    });
  }

  close(): void {
    this.pending?.resolve(null);
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./checkpoint.worker.ts", import.meta.url), {
      type: "module",
      name: "mathin-board-checkpoint",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const pending = this.pending;
      if (!pending || pending.taskId !== event.data.taskId) return;
      this.pending = null;
      if (!event.data.ok || !event.data.result) {
        pending.reject(new Error(event.data.error ?? "CHECKPOINT_PREPARE_FAILED"));
        return;
      }
      pending.resolve(event.data.result);
    };
    worker.onerror = () => {
      const pending = this.pending;
      this.pending = null;
      pending?.reject(new Error("CHECKPOINT_WORKER_FAILED"));
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
