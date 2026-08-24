/// <reference lib="webworker" />

import type { BoardItem } from "@/features/whiteboard/types";
import { buildBoardCheckpoint } from "./codec";

interface PrepareMessage {
  taskId: number;
  items: BoardItem[];
}

self.onmessage = (event: MessageEvent<PrepareMessage>) => {
  try {
    const result = buildBoardCheckpoint(event.data.items);
    self.postMessage({ taskId: event.data.taskId, ok: true, result });
  } catch (error) {
    self.postMessage({
      taskId: event.data.taskId,
      ok: false,
      error: error instanceof Error ? error.message : "CHECKPOINT_PREPARE_FAILED",
    });
  }
};

export {};
