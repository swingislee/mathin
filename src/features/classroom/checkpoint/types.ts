import type { BoardItem } from "@/features/whiteboard/types";

export interface PreparedBoardCheckpoint {
  chunks: BoardItem[][];
  itemCount: number;
  contentBytes: number;
  originalPointCount: number;
  storedPointCount: number;
  resampled: boolean;
}

export interface PendingBoardCheckpoint extends PreparedBoardCheckpoint {
  scope: "formal" | "rehearsal";
  checkpointId: string;
  sessionId: string;
  boardKey: string;
  writerId: string;
  writerSeq: number;
  baseVersion: number;
  sourceRevision: number;
  preparedAt: string;
}

export interface SessionBoardCheckpoint {
  boardKey: string;
  version: number;
  checkpointId: string;
  createdAt: string;
  itemCount: number;
  chunkCount: number;
  contentBytes: number;
  items: BoardItem[];
}

export type CheckpointSource = "memory" | "legacy-v1" | "server-v2" | "local-v2";

export interface BoardCheckpointStatus {
  state: "idle" | "dirty" | "preparing" | "pending" | "saved" | "error";
  source: CheckpointSource;
  version: number | null;
  checkpointId: string | null;
  chunkCount: number;
  itemCount: number;
  contentBytes: number;
  message: string | null;
}
