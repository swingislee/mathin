import { z } from "zod";
import {
  canonicalFingerprint64,
  canonicalJsonStringify,
  canonicalSha256,
  createInitialSpatialRuntimeState,
  forkStudentLocalRuntimeState,
  parseSpatialPageDoc,
  reduceSpatialRuntimeState,
  spatialCommand,
  spatialCommandActorSchema,
  spatialCommandPayloadSchema,
  spatialCommandSchema,
  spatialRuntimeBranchSchema,
  spatialRuntimeStateSchema,
  validateSpatialRuntimeStateForPage,
  verifySpatialPageDoc,
  type SpatialCommand,
  type SpatialCommandActor,
  type SpatialPageDoc,
  type SpatialRuntimeBranch,
  type SpatialRuntimeState,
} from "../domain";

export const SPATIAL_CLASSROOM_HOST_VERSION = "spatial-classroom-host-v1" as const;
export const SPATIAL_RUNTIME_SNAPSHOT_VERSION = "spatial-runtime-snapshot-v1" as const;
export const SPATIAL_REPLAY_BUNDLE_VERSION = "spatial-replay-bundle-v1" as const;

export const SPATIAL_CLASSROOM_HOST_LIMITS = {
  checkpointRecommendedAfterCommands: 64,
  maxCommandsAfterSnapshot: 512,
  maxReplayBundleBytes: 2 * 1_024 * 1_024,
} as const;

export const SPATIAL_CLASSROOM_HOST_ERROR_CODES = {
  snapshotSceneMismatch: "SPATIAL_HOST_SNAPSHOT_SCENE_MISMATCH",
  snapshotHashMismatch: "SPATIAL_HOST_SNAPSHOT_HASH_MISMATCH",
  writerBranchMismatch: "SPATIAL_HOST_WRITER_BRANCH_MISMATCH",
  authorityRequired: "SPATIAL_HOST_AUTHORITY_REQUIRED",
  commandIdReused: "SPATIAL_HOST_COMMAND_ID_REUSED",
  replayLogLimit: "SPATIAL_HOST_REPLAY_LOG_LIMIT",
  hostStateDrift: "SPATIAL_HOST_STATE_DRIFT",
} as const;

export type SpatialClassroomHostErrorCode =
  (typeof SPATIAL_CLASSROOM_HOST_ERROR_CODES)[keyof typeof SPATIAL_CLASSROOM_HOST_ERROR_CODES];

export class SpatialClassroomHostContractError extends Error {
  constructor(public readonly code: SpatialClassroomHostErrorCode, message: string) {
    super(message);
    this.name = "SpatialClassroomHostContractError";
  }
}

function fail(code: SpatialClassroomHostErrorCode, message: string): never {
  throw new SpatialClassroomHostContractError(code, message);
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "invalid sha256");

export const spatialRuntimeSnapshotSchema = z
  .object({
    snapshotVersion: z.literal(SPATIAL_RUNTIME_SNAPSHOT_VERSION),
    sceneRevisionHash: sha256Schema,
    resetEpoch: z.number().int().min(0),
    throughSequence: z.number().int().min(0),
    branch: spatialRuntimeBranchSchema,
    state: spatialRuntimeStateSchema,
    stateHash: sha256Schema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.sceneRevisionHash !== snapshot.state.sceneRevisionHash) {
      context.addIssue({ code: "custom", message: "snapshot scene hash must match state", path: ["sceneRevisionHash"] });
    }
    if (snapshot.resetEpoch !== snapshot.state.resetEpoch) {
      context.addIssue({ code: "custom", message: "snapshot epoch must match state", path: ["resetEpoch"] });
    }
    if (snapshot.throughSequence !== snapshot.state.lastAppliedSequence) {
      context.addIssue({ code: "custom", message: "snapshot sequence must match state", path: ["throughSequence"] });
    }
    if (canonicalJsonStringify(snapshot.branch) !== canonicalJsonStringify(snapshot.state.branch)) {
      context.addIssue({ code: "custom", message: "snapshot branch must match state", path: ["branch"] });
    }
  });

export const spatialReplayBundleSchema = z
  .object({
    bundleVersion: z.literal(SPATIAL_REPLAY_BUNDLE_VERSION),
    snapshot: spatialRuntimeSnapshotSchema,
    commands: z.array(spatialCommandSchema).max(SPATIAL_CLASSROOM_HOST_LIMITS.maxCommandsAfterSnapshot),
  })
  .strict()
  .superRefine((bundle, context) => {
    let expectedSequence = bundle.snapshot.throughSequence + 1;
    let expectedEpoch = bundle.snapshot.resetEpoch;
    const commandIds = new Set<string>(
      bundle.snapshot.state.lastCommandId ? [bundle.snapshot.state.lastCommandId] : [],
    );
    bundle.commands.forEach((command, index) => {
      const path = ["commands", index];
      if (command.sceneRevisionHash !== bundle.snapshot.sceneRevisionHash) {
        context.addIssue({ code: "custom", message: "command scene hash must match snapshot", path });
      }
      if (canonicalJsonStringify(command.branch) !== canonicalJsonStringify(bundle.snapshot.branch)) {
        context.addIssue({ code: "custom", message: "command branch must match snapshot", path });
      }
      if (command.sequence !== expectedSequence) {
        context.addIssue({ code: "custom", message: "commands must continue the snapshot sequence", path: [...path, "sequence"] });
      }
      if (command.resetEpoch !== expectedEpoch) {
        context.addIssue({ code: "custom", message: "command epoch must continue the snapshot epoch", path: [...path, "resetEpoch"] });
      }
      if (commandIds.has(command.commandId)) {
        context.addIssue({ code: "custom", message: "command ids must be unique within a replay bundle", path: [...path, "commandId"] });
      }
      commandIds.add(command.commandId);
      expectedSequence += 1;
      if (command.payload.kind === "scene.reset") expectedEpoch += 1;
    });

    const bytes = new TextEncoder().encode(canonicalJsonStringify(bundle)).byteLength;
    if (bytes > SPATIAL_CLASSROOM_HOST_LIMITS.maxReplayBundleBytes) {
      context.addIssue({ code: "custom", message: `replay bundle size ${bytes} exceeds limit`, path: [] });
    }
  });

export type SpatialRuntimeSnapshot = z.infer<typeof spatialRuntimeSnapshotSchema>;
export type SpatialReplayBundle = z.infer<typeof spatialReplayBundleSchema>;

export interface SpatialClassroomHost {
  readonly hostVersion: typeof SPATIAL_CLASSROOM_HOST_VERSION;
  readonly writer: SpatialCommandActor;
  readonly baseline: SpatialRuntimeSnapshot;
  readonly commandsAfterSnapshot: readonly SpatialCommand[];
  readonly state: SpatialRuntimeState;
}

export interface SpatialClassroomCommandResult {
  readonly command: SpatialCommand;
  readonly host: SpatialClassroomHost;
  readonly checkpointRecommended: boolean;
}

export interface SpatialReplayResult {
  readonly state: SpatialRuntimeState;
  readonly snapshotSequence: number;
  readonly appliedCommandCount: number;
  readonly finalStateHash: string;
}

function branchEquals(left: SpatialRuntimeBranch, right: SpatialRuntimeBranch): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

function writerMatchesBranch(writer: SpatialCommandActor, branch: SpatialRuntimeBranch): boolean {
  if (branch.kind === "teacher-authority") return writer.kind === "teacher-controller";
  return writer.kind === "student" && writer.actorId === branch.studentActorId;
}

function assertWriterMatchesBranch(writer: SpatialCommandActor, branch: SpatialRuntimeBranch): void {
  if (!writerMatchesBranch(writer, branch)) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.writerBranchMismatch, "host writer does not own the runtime branch");
  }
}

function assertHostTail(host: SpatialClassroomHost): void {
  const tail = host.commandsAfterSnapshot.at(-1);
  const expectedSequence = tail?.sequence ?? host.baseline.throughSequence;
  if (host.state.lastAppliedSequence !== expectedSequence) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.hostStateDrift, "host state sequence does not match its replay tail");
  }
  if (!branchEquals(host.state.branch, host.baseline.branch)) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.hostStateDrift, "host state branch does not match its snapshot");
  }
  if (tail && (host.state.lastCommandId !== tail.commandId || host.state.lastCommandFingerprint !== canonicalFingerprint64(tail))) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.hostStateDrift, "host state command marker does not match its replay tail");
  }
}

export function parseSpatialRuntimeSnapshot(input: unknown): SpatialRuntimeSnapshot {
  return spatialRuntimeSnapshotSchema.parse(input);
}

export function parseSpatialReplayBundle(input: unknown): SpatialReplayBundle {
  return spatialReplayBundleSchema.parse(input);
}

export async function materializeSpatialRuntimeSnapshot(
  pageInput: unknown,
  stateInput: unknown,
): Promise<SpatialRuntimeSnapshot> {
  const page = await verifySpatialPageDoc(pageInput);
  const state = validateSpatialRuntimeStateForPage(page, stateInput);
  return parseSpatialRuntimeSnapshot({
    snapshotVersion: SPATIAL_RUNTIME_SNAPSHOT_VERSION,
    sceneRevisionHash: page.sceneHash,
    resetEpoch: state.resetEpoch,
    throughSequence: state.lastAppliedSequence,
    branch: state.branch,
    state,
    stateHash: await canonicalSha256(state),
  });
}

export async function verifySpatialRuntimeSnapshot(
  pageInput: unknown,
  snapshotInput: unknown,
): Promise<SpatialRuntimeSnapshot> {
  const page = await verifySpatialPageDoc(pageInput);
  const snapshot = parseSpatialRuntimeSnapshot(snapshotInput);
  if (snapshot.sceneRevisionHash !== page.sceneHash) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.snapshotSceneMismatch, "snapshot scene hash does not match frozen page");
  }
  validateSpatialRuntimeStateForPage(page, snapshot.state);
  if ((await canonicalSha256(snapshot.state)) !== snapshot.stateHash) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.snapshotHashMismatch, "snapshot state hash does not match its canonical state");
  }
  return snapshot;
}

export function createSpatialClassroomCommandEnvelope(
  pageInput: unknown,
  stateInput: unknown,
  writerInput: unknown,
  commandId: string,
  payloadInput: unknown,
): SpatialCommand {
  const page = parseSpatialPageDoc(pageInput);
  const state = validateSpatialRuntimeStateForPage(page, stateInput);
  const writer = spatialCommandActorSchema.parse(writerInput);
  const payload = spatialCommandPayloadSchema.parse(payloadInput);
  assertWriterMatchesBranch(writer, state.branch);
  return spatialCommand({
    commandId,
    sceneRevisionHash: page.sceneHash,
    resetEpoch: state.resetEpoch,
    sequence: state.lastAppliedSequence + 1,
    branch: state.branch,
    actor: writer,
    payload,
  });
}

async function hostFromState(
  page: SpatialPageDoc,
  state: SpatialRuntimeState,
  writer: SpatialCommandActor,
): Promise<SpatialClassroomHost> {
  assertWriterMatchesBranch(writer, state.branch);
  return {
    hostVersion: SPATIAL_CLASSROOM_HOST_VERSION,
    writer,
    baseline: await materializeSpatialRuntimeSnapshot(page, state),
    commandsAfterSnapshot: [],
    state,
  };
}

export async function createTeacherSpatialClassroomHost(
  pageInput: unknown,
  writerInput: unknown,
): Promise<SpatialClassroomHost> {
  const page = await verifySpatialPageDoc(pageInput);
  const writer = spatialCommandActorSchema.parse(writerInput);
  if (writer.kind !== "teacher-controller") {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.authorityRequired, "initial classroom host requires a teacher controller");
  }
  return hostFromState(page, createInitialSpatialRuntimeState(page), writer);
}

export async function forkStudentSpatialClassroomHost(
  pageInput: unknown,
  authorityStateInput: unknown,
  writerInput: unknown,
): Promise<SpatialClassroomHost> {
  const page = await verifySpatialPageDoc(pageInput);
  const authorityState = validateSpatialRuntimeStateForPage(page, authorityStateInput);
  const writer = spatialCommandActorSchema.parse(writerInput);
  if (writer.kind !== "student") {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.writerBranchMismatch, "student branch requires its owning student writer");
  }
  return hostFromState(page, forkStudentLocalRuntimeState(page, authorityState, writer.actorId), writer);
}

export function applySpatialClassroomCommandIntent(
  pageInput: unknown,
  host: SpatialClassroomHost,
  commandId: string,
  payloadInput: unknown,
): SpatialClassroomCommandResult {
  const page = parseSpatialPageDoc(pageInput);
  const state = validateSpatialRuntimeStateForPage(page, host.state);
  const writer = spatialCommandActorSchema.parse(host.writer);
  assertWriterMatchesBranch(writer, state.branch);
  assertHostTail(host);
  if (host.commandsAfterSnapshot.length >= SPATIAL_CLASSROOM_HOST_LIMITS.maxCommandsAfterSnapshot) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.replayLogLimit, "checkpoint is required before appending another command");
  }
  if (state.lastCommandId === commandId || host.commandsAfterSnapshot.some((command) => command.commandId === commandId)) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.commandIdReused, `command id has already been used: ${commandId}`);
  }

  const command = createSpatialClassroomCommandEnvelope(page, state, writer, commandId, payloadInput);
  const nextState = reduceSpatialRuntimeState(page, state, command);
  const commandsAfterSnapshot = [...host.commandsAfterSnapshot, command];
  return {
    command,
    host: {
      hostVersion: SPATIAL_CLASSROOM_HOST_VERSION,
      writer,
      baseline: host.baseline,
      commandsAfterSnapshot,
      state: nextState,
    },
    checkpointRecommended:
      commandsAfterSnapshot.length >= SPATIAL_CLASSROOM_HOST_LIMITS.checkpointRecommendedAfterCommands,
  };
}

export async function replaySpatialClassroomBundle(
  pageInput: unknown,
  bundleInput: unknown,
): Promise<SpatialReplayResult> {
  const page = await verifySpatialPageDoc(pageInput);
  const bundle = parseSpatialReplayBundle(bundleInput);
  const snapshot = await verifySpatialRuntimeSnapshot(page, bundle.snapshot);
  let state = snapshot.state;
  bundle.commands.forEach((command) => {
    state = reduceSpatialRuntimeState(page, state, command);
  });
  return {
    state,
    snapshotSequence: snapshot.throughSequence,
    appliedCommandCount: bundle.commands.length,
    finalStateHash: await canonicalSha256(state),
  };
}

export async function createSpatialClassroomReplayBundle(
  pageInput: unknown,
  host: SpatialClassroomHost,
): Promise<SpatialReplayBundle> {
  const page = await verifySpatialPageDoc(pageInput);
  assertHostTail(host);
  const bundle = parseSpatialReplayBundle({
    bundleVersion: SPATIAL_REPLAY_BUNDLE_VERSION,
    snapshot: host.baseline,
    commands: host.commandsAfterSnapshot,
  });
  const replay = await replaySpatialClassroomBundle(page, bundle);
  if (canonicalJsonStringify(replay.state) !== canonicalJsonStringify(host.state)) {
    fail(SPATIAL_CLASSROOM_HOST_ERROR_CODES.hostStateDrift, "host state does not equal snapshot plus replay tail");
  }
  return bundle;
}

export async function checkpointSpatialClassroomHost(
  pageInput: unknown,
  host: SpatialClassroomHost,
): Promise<SpatialClassroomHost> {
  const page = await verifySpatialPageDoc(pageInput);
  await createSpatialClassroomReplayBundle(page, host);
  return hostFromState(page, host.state, spatialCommandActorSchema.parse(host.writer));
}

export async function resumeSpatialClassroomHost(
  pageInput: unknown,
  bundleInput: unknown,
  writerInput: unknown,
): Promise<SpatialClassroomHost> {
  const page = await verifySpatialPageDoc(pageInput);
  const bundle = parseSpatialReplayBundle(bundleInput);
  const writer = spatialCommandActorSchema.parse(writerInput);
  assertWriterMatchesBranch(writer, bundle.snapshot.branch);
  const replay = await replaySpatialClassroomBundle(page, bundle);
  return {
    hostVersion: SPATIAL_CLASSROOM_HOST_VERSION,
    writer,
    baseline: bundle.snapshot,
    commandsAfterSnapshot: bundle.commands,
    state: replay.state,
  };
}
