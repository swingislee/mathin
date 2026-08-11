import { describe, expect, it } from "vitest";
import {
  SPATIAL_RUNTIME_ERROR_CODES,
  canonicalSha256,
  createInitialSpatialRuntimeState,
  forkStudentLocalRuntimeState,
  materializeSpatialPageDoc,
  parseSpatialCommand,
  rational,
  reduceSpatialRuntimeState,
  spatialCommand,
  spatialCommandSchema,
  type SpatialCommand,
  type SpatialCommandPayload,
  type SpatialPageDoc,
  type SpatialRuntimeState,
} from "@/features/spatial-math/domain";
import { standardSpatialPageDraft, validSpatialScene } from "./fixtures/spatial-page";

async function runtimePage(): Promise<SpatialPageDoc> {
  const scene = validSpatialScene();
  scene.presentation.cameraBookmarks.push({
    id: "camera.right",
    label: { zh: "右面", en: "Right" },
    projection: "orthographic",
    position: { x: 8, y: 1, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    zoom: 1,
  });
  scene.presentation.layers.push({
    id: "layer.y0",
    label: { zh: "第一层", en: "Layer one" },
    initiallyVisible: true,
    selector: { kind: "voxel-axis-range", entityId: "voxel.main", axis: "y", min: 0, max: 0 },
  });
  scene.model.parameters.push({
    id: "parameter.size",
    label: { zh: "尺寸", en: "Size" },
    unit: "unit",
    initial: rational(1),
    min: rational(0),
    max: rational(2),
    step: rational(1),
  });
  scene.sequence = {
    initialStepId: "step.initial",
    steps: [
      {
        id: "step.initial",
        title: { zh: "初始观察", en: "Initial view" },
        transition: "none",
        durationMs: 0,
        actions: [{ kind: "camera.apply", cameraId: "camera.front" }],
      },
      {
        id: "step.reveal",
        title: { zh: "揭示", en: "Reveal" },
        transition: "none",
        durationMs: 0,
        actions: [
          { kind: "layer.set", layerId: "layer.y0", visible: false },
          { kind: "entity.select", entityIds: ["voxel.main"] },
        ],
      },
    ],
  };
  return materializeSpatialPageDoc(standardSpatialPageDraft(scene));
}

function teacherCommand(
  page: SpatialPageDoc,
  state: SpatialRuntimeState,
  sequence: number,
  payload: SpatialCommandPayload,
  overrides: Partial<SpatialCommand> = {},
): SpatialCommand {
  return spatialCommand({
    commandId: `command.teacher.${sequence}`,
    sceneRevisionHash: page.sceneHash,
    resetEpoch: state.resetEpoch,
    sequence,
    branch: state.branch,
    actor: { kind: "teacher-controller", actorId: "teacher.001" },
    payload,
    ...overrides,
  });
}

function studentCommand(
  page: SpatialPageDoc,
  state: SpatialRuntimeState,
  sequence: number,
  payload: SpatialCommandPayload,
): SpatialCommand {
  return spatialCommand({
    commandId: `command.student.${sequence}`,
    sceneRevisionHash: page.sceneHash,
    resetEpoch: state.resetEpoch,
    sequence,
    branch: state.branch,
    actor: { kind: "student", actorId: "student.001" },
    payload,
  });
}

describe("spatial-runtime-state-v1 initialization and replay", () => {
  it("derives a bounded canonical state from scene and 4:3 page defaults", async () => {
    const page = await runtimePage();
    const state = createInitialSpatialRuntimeState(page);

    expect(state).toMatchObject({
      stateVersion: "spatial-runtime-state-v1",
      sceneRevisionHash: page.sceneHash,
      resetEpoch: 0,
      branch: { kind: "teacher-authority" },
      ownershipMode: "teacher-follow",
      cameraBookmarkId: "camera.front",
      activeStepId: "step.initial",
      lastAppliedSequence: 0,
      lastCommandId: null,
      lastCommandFingerprint: null,
    });
    expect(state.layerVisibility).toEqual([{ layerId: "layer.y0", visible: true }]);
    expect(state.parameterValues).toEqual([{ parameterId: "parameter.size", value: rational(1) }]);
  });

  it("replays semantic commands to the same canonical state on independent clients", async () => {
    const page = await runtimePage();
    const commands: SpatialCommandPayload[] = [
      { kind: "view.set", view: "right" },
      { kind: "camera.bookmark.apply", cameraId: "camera.right" },
      { kind: "step.go", stepId: "step.reveal" },
      { kind: "parameter.set", parameterId: "parameter.size", value: rational(2) },
    ];

    const replay = () => {
      let state = createInitialSpatialRuntimeState(page);
      commands.forEach((payload, index) => {
        state = reduceSpatialRuntimeState(page, state, teacherCommand(page, state, index + 1, payload));
      });
      return state;
    };

    const left = replay();
    const right = replay();
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      activeView: "right",
      cameraBookmarkId: "camera.right",
      activeStepId: "step.reveal",
      selectedEntityIds: ["voxel.main"],
      layerVisibility: [{ layerId: "layer.y0", visible: false }],
      lastAppliedSequence: 4,
    });
    await expect(canonicalSha256(left)).resolves.toBe(await canonicalSha256(right));
  });

  it("applies an exact duplicate idempotently", async () => {
    const page = await runtimePage();
    const initial = createInitialSpatialRuntimeState(page);
    const command = teacherCommand(page, initial, 1, { kind: "view.set", view: "top" });
    const applied = reduceSpatialRuntimeState(page, initial, command);

    expect(reduceSpatialRuntimeState(page, applied, command)).toEqual(applied);

    const collision = spatialCommand({
      ...command,
      payload: { kind: "view.set", view: "right" },
    });
    expect(() => reduceSpatialRuntimeState(page, applied, collision)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.operationInvalid }),
    );
  });
});

describe("spatial-command-v1 ordering, epoch and authority", () => {
  it("rejects sequence gaps and stale non-duplicate commands", async () => {
    const page = await runtimePage();
    const initial = createInitialSpatialRuntimeState(page);
    const gap = teacherCommand(page, initial, 2, { kind: "view.set", view: "top" });
    expect(() => reduceSpatialRuntimeState(page, initial, gap)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.sequenceGap }),
    );

    const first = reduceSpatialRuntimeState(
      page,
      initial,
      teacherCommand(page, initial, 1, { kind: "view.set", view: "top" }),
    );
    const stale = teacherCommand(page, first, 1, { kind: "view.set", view: "front" }, { commandId: "command.stale" });
    expect(() => reduceSpatialRuntimeState(page, first, stale)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.staleSequence }),
    );
  });

  it("rejects a forged scene hash and stale epoch", async () => {
    const page = await runtimePage();
    const state = createInitialSpatialRuntimeState(page);
    const forged = teacherCommand(
      page,
      state,
      1,
      { kind: "view.set", view: "front" },
      { sceneRevisionHash: "0".repeat(64) },
    );
    expect(() => reduceSpatialRuntimeState(page, state, forged)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.commandSceneMismatch }),
    );

    const staleEpoch = teacherCommand(page, state, 1, { kind: "view.set", view: "front" }, { resetEpoch: 1 });
    expect(() => reduceSpatialRuntimeState(page, state, staleEpoch)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.epochMismatch }),
    );
  });

  it("keeps teacher authority and student-local branches separate", async () => {
    const page = await runtimePage();
    const authority = createInitialSpatialRuntimeState(page);
    expect(() => forkStudentLocalRuntimeState(page, authority, "student.001")).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.ownershipNotAllowed }),
    );

    const opened = reduceSpatialRuntimeState(
      page,
      authority,
      teacherCommand(page, authority, 1, { kind: "ownership.set", mode: "student-local-explore" }),
    );
    const local = forkStudentLocalRuntimeState(page, opened, "student.001");
    const explored = reduceSpatialRuntimeState(
      page,
      local,
      studentCommand(page, local, 1, { kind: "camera.bookmark.apply", cameraId: "camera.right" }),
    );

    expect(explored.cameraBookmarkId).toBe("camera.right");
    expect(opened.cameraBookmarkId).toBe("camera.front");
    expect(() =>
      reduceSpatialRuntimeState(
        page,
        local,
        studentCommand(page, local, 1, { kind: "ownership.set", mode: "teacher-follow" }),
      ),
    ).toThrowError(expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.actorNotAllowed }));
  });

  it("increments reset epoch, restores defaults and rejects an old local outbox command", async () => {
    const page = await runtimePage();
    const authority = createInitialSpatialRuntimeState(page);
    const opened = reduceSpatialRuntimeState(
      page,
      authority,
      teacherCommand(page, authority, 1, { kind: "ownership.set", mode: "student-local-explore" }),
    );
    const oldLocal = forkStudentLocalRuntimeState(page, opened, "student.001");
    const queued = studentCommand(page, oldLocal, 1, { kind: "view.set", view: "top" });

    const reset = reduceSpatialRuntimeState(
      page,
      opened,
      teacherCommand(page, opened, 2, { kind: "scene.reset" }),
    );
    expect(reset).toMatchObject({ resetEpoch: 1, ownershipMode: "teacher-follow", activeView: null });

    const reopened = reduceSpatialRuntimeState(
      page,
      reset,
      teacherCommand(page, reset, 3, { kind: "ownership.set", mode: "student-local-explore" }),
    );
    const newLocal = forkStudentLocalRuntimeState(page, reopened, "student.001");
    expect(() => reduceSpatialRuntimeState(page, newLocal, queued)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.epochMismatch }),
    );
  });
});

describe("spatial runtime model edits and command boundaries", () => {
  it("stores canonical voxel deltas without copying the full scene", async () => {
    const page = await runtimePage();
    let state = createInitialSpatialRuntimeState(page);
    state = reduceSpatialRuntimeState(
      page,
      state,
      teacherCommand(page, state, 1, { kind: "voxel.add", entityId: "voxel.main", cells: [{ x: 1, y: 0, z: 0 }] }),
    );
    state = reduceSpatialRuntimeState(
      page,
      state,
      teacherCommand(page, state, 2, {
        kind: "voxel.paint",
        entityId: "voxel.main",
        cells: [{ x: 1, y: 0, z: 0 }],
        directions: ["x+", "y+"],
        materialToken: "voxel.highlight",
      }),
    );

    expect(state.voxelEdits).toEqual([
      {
        entityId: "voxel.main",
        addedCells: [{ x: 1, y: 0, z: 0 }],
        removedCells: [],
        paints: [
          {
            cell: { x: 1, y: 0, z: 0 },
            faces: [
              { direction: "x+", materialToken: "voxel.highlight" },
              { direction: "y+", materialToken: "voxel.highlight" },
            ],
          },
        ],
      },
    ]);

    state = reduceSpatialRuntimeState(
      page,
      state,
      teacherCommand(page, state, 3, { kind: "voxel.remove", entityId: "voxel.main", cells: [{ x: 1, y: 0, z: 0 }] }),
    );
    expect(state.voxelEdits).toEqual([]);
  });

  it("rejects invalid voxel operations, references and parameter steps", async () => {
    const page = await runtimePage();
    const state = createInitialSpatialRuntimeState(page);
    const duplicate = teacherCommand(page, state, 1, {
      kind: "voxel.add",
      entityId: "voxel.main",
      cells: [{ x: 0, y: 0, z: 0 }],
    });
    expect(() => reduceSpatialRuntimeState(page, state, duplicate)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.operationInvalid }),
    );
    const unknownCamera = teacherCommand(page, state, 1, {
      kind: "camera.bookmark.apply",
      cameraId: "camera.missing",
    });
    expect(() => reduceSpatialRuntimeState(page, state, unknownCamera)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.referenceInvalid }),
    );
    const halfStep = teacherCommand(page, state, 1, {
      kind: "parameter.set",
      parameterId: "parameter.size",
      value: rational(1, 2),
    });
    expect(() => reduceSpatialRuntimeState(page, state, halfStep)).toThrowError(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.operationInvalid }),
    );
  });

  it("rejects per-frame camera payloads, unknown fields and unstable voxel ordering", async () => {
    const page = await runtimePage();
    const state = createInitialSpatialRuntimeState(page);
    const base = {
      commandVersion: "spatial-command-v1",
      commandId: "command.invalid",
      sceneRevisionHash: page.sceneHash,
      resetEpoch: 0,
      sequence: 1,
      delivery: "durable-semantic",
      branch: state.branch,
      actor: { kind: "teacher-controller", actorId: "teacher.001" },
    };

    expect(spatialCommandSchema.safeParse({ ...base, payload: { kind: "camera.drag", x: 1, y: 2 } }).success).toBe(false);
    expect(
      spatialCommandSchema.safeParse({
        ...base,
        payload: { kind: "view.set", view: "front", frameTime: 16 },
      }).success,
    ).toBe(false);
    expect(
      spatialCommandSchema.safeParse({
        ...base,
        payload: {
          kind: "voxel.add",
          entityId: "voxel.main",
          cells: [
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 0 },
          ],
        },
      }).success,
    ).toBe(false);
    expect(() => parseSpatialCommand({ ...base, payload: { kind: "scene.reset" }, script: "alert(1)" })).toThrow();
  });
});
