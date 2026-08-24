import type { SessionBoardCheckpoint } from "./types";

/** During writer rollback, a later legacy snapshot must supersede the last v2 checkpoint. */
export function shouldApplyLegacyBoardSnapshot(
  checkpoint: SessionBoardCheckpoint | undefined,
  legacyCreatedAt: string | undefined,
): boolean {
  if (!checkpoint) return true;
  if (!legacyCreatedAt) return false;
  const legacyTime = Date.parse(legacyCreatedAt);
  const checkpointTime = Date.parse(checkpoint.createdAt);
  return Number.isFinite(legacyTime) && Number.isFinite(checkpointTime) && legacyTime > checkpointTime;
}
