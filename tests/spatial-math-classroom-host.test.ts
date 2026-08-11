import { describe, expect, it } from "vitest";
import {
  SPATIAL_RUNTIME_ERROR_CODES,
  canonicalSha256,
  reduceSpatialRuntimeState,
  type SpatialCommandActor,
} from "@/features/spatial-math/domain";
import {
  SPATIAL_CLASSROOM_HOST_ERROR_CODES,
  applySpatialClassroomCommandIntent,
  checkpointSpatialClassroomHost,
  createSpatialClassroomCommandEnvelope,
  createSpatialClassroomReplayBundle,
  createTeacherSpatialClassroomHost,
  forkStudentSpatialClassroomHost,
  parseSpatialReplayBundle,
  replaySpatialClassroomBundle,
  resumeSpatialClassroomHost,
  verifySpatialRuntimeSnapshot,
} from "@/features/spatial-math/runtime";
import { cubeFoldSpatialPage } from "./fixtures/spatial-polyhedron-scene";

const teacher: SpatialCommandActor = { kind: "teacher-controller", actorId: "teacher.001" };
const student: SpatialCommandActor = { kind: "student", actorId: "student.001" };

describe("spatial-classroom-host-v1 command and replay contract", () => {
  it("wraps a 4:3 teaching intent with the authoritative branch, epoch and next sequence", async () => {
    const page = await cubeFoldSpatialPage();
    const host = await createTeacherSpatialClassroomHost(page, teacher);
    const command = createSpatialClassroomCommandEnvelope(
      page,
      host.state,
      teacher,
      "command.teacher.step.1",
      { kind: "step.go", stepId: "step.explore" },
    );

    expect(page.layout.profile).toBe("standard-4x3");
    expect(command).toMatchObject({
      commandVersion: "spatial-command-v1",
      commandId: "command.teacher.step.1",
      sceneRevisionHash: page.sceneHash,
      resetEpoch: 0,
      sequence: 1,
      delivery: "durable-semantic",
      branch: { kind: "teacher-authority" },
      actor: teacher,
      payload: { kind: "step.go", stepId: "step.explore" },
    });
  });

  it("converges one teacher and thirty late-joining followers from a snapshot plus semantic tail", async () => {
    const page = await cubeFoldSpatialPage();
    let host = await createTeacherSpatialClassroomHost(page, teacher);
    for (const [commandId, payload] of [
      ["command.teacher.explore", { kind: "step.go", stepId: "step.explore" }],
      ["command.teacher.fold", { kind: "net.foldTo", entityId: "polyhedron.cube", progress: 0.25 }],
      ["command.teacher.reset", { kind: "scene.reset" }],
      ["command.teacher.verify", { kind: "step.go", stepId: "step.verify" }],
    ] as const) {
      host = applySpatialClassroomCommandIntent(page, host, commandId, payload).host;
    }

    const bundle = await createSpatialClassroomReplayBundle(page, host);
    const followers = await Promise.all(
      Array.from({ length: 30 }, () => replaySpatialClassroomBundle(page, structuredClone(bundle))),
    );
    const authorityHash = await canonicalSha256(host.state);

    expect(bundle.snapshot.throughSequence).toBe(0);
    expect(bundle.commands.map((command) => command.sequence)).toEqual([1, 2, 3, 4]);
    expect(bundle.commands.map((command) => command.resetEpoch)).toEqual([0, 0, 0, 1]);
    expect(host.state).toMatchObject({ resetEpoch: 1, lastAppliedSequence: 4, activeStepId: "step.verify" });
    expect(followers).toHaveLength(30);
    followers.forEach((follower) => {
      expect(follower.state).toEqual(host.state);
      expect(follower.finalStateHash).toBe(authorityHash);
      expect(follower.appliedCommandCount).toBe(4);
    });
  });

  it("checkpoints, resumes and continues with no sequence or epoch drift", async () => {
    const page = await cubeFoldSpatialPage();
    let host = await createTeacherSpatialClassroomHost(page, teacher);
    host = applySpatialClassroomCommandIntent(page, host, "command.teacher.reset", { kind: "scene.reset" }).host;
    host = applySpatialClassroomCommandIntent(page, host, "command.teacher.fold", {
      kind: "net.foldTo",
      entityId: "polyhedron.cube",
      progress: 0.5,
    }).host;

    const checkpointed = await checkpointSpatialClassroomHost(page, host);
    expect(checkpointed.baseline).toMatchObject({ resetEpoch: 1, throughSequence: 2 });
    expect(checkpointed.commandsAfterSnapshot).toEqual([]);

    const continued = applySpatialClassroomCommandIntent(page, checkpointed, "command.teacher.camera", {
      kind: "camera.bookmark.apply",
      cameraId: "camera.top",
    }).host;
    const bundle = await createSpatialClassroomReplayBundle(page, continued);
    const resumed = await resumeSpatialClassroomHost(page, bundle, teacher);
    const final = applySpatialClassroomCommandIntent(page, resumed, "command.teacher.verify", {
      kind: "step.go",
      stepId: "step.verify",
    }).host;

    expect(bundle.snapshot.throughSequence).toBe(2);
    expect(bundle.commands).toHaveLength(1);
    expect(final.state).toMatchObject({
      resetEpoch: 1,
      lastAppliedSequence: 4,
      cameraBookmarkId: "camera.perspective",
      activeStepId: "step.verify",
    });
  });

  it("keeps a student-local replay private and rejects its old outbox command after teacher reset", async () => {
    const page = await cubeFoldSpatialPage();
    let authority = await createTeacherSpatialClassroomHost(page, teacher);
    authority = applySpatialClassroomCommandIntent(page, authority, "command.teacher.open", {
      kind: "ownership.set",
      mode: "student-local-explore",
    }).host;

    let local = await forkStudentSpatialClassroomHost(page, authority.state, student);
    const queued = createSpatialClassroomCommandEnvelope(page, local.state, student, "command.student.queued", {
      kind: "camera.bookmark.apply",
      cameraId: "camera.top",
    });
    local = applySpatialClassroomCommandIntent(page, local, "command.student.right", {
      kind: "camera.bookmark.apply",
      cameraId: "camera.right",
    }).host;
    const localReplay = await replaySpatialClassroomBundle(page, await createSpatialClassroomReplayBundle(page, local));
    expect(localReplay.state.branch).toEqual({ kind: "student-local", studentActorId: "student.001" });
    expect(localReplay.state.cameraBookmarkId).toBe("camera.right");
    expect(authority.state.cameraBookmarkId).toBe("camera.front");

    authority = applySpatialClassroomCommandIntent(page, authority, "command.teacher.reset", { kind: "scene.reset" }).host;
    authority = applySpatialClassroomCommandIntent(page, authority, "command.teacher.reopen", {
      kind: "ownership.set",
      mode: "student-local-explore",
    }).host;
    const rebasedLocal = await forkStudentSpatialClassroomHost(page, authority.state, student);
    expect(() => reduceSpatialRuntimeState(page, rebasedLocal.state, queued)).toThrow(
      expect.objectContaining({ code: SPATIAL_RUNTIME_ERROR_CODES.epochMismatch }),
    );
  });

  it("rejects snapshot tampering, sequence gaps, writer mismatch and reused command ids", async () => {
    const page = await cubeFoldSpatialPage();
    let host = await createTeacherSpatialClassroomHost(page, teacher);
    host = applySpatialClassroomCommandIntent(page, host, "command.teacher.once", {
      kind: "camera.bookmark.apply",
      cameraId: "camera.right",
    }).host;
    expect(() =>
      applySpatialClassroomCommandIntent(page, host, "command.teacher.once", {
        kind: "camera.bookmark.apply",
        cameraId: "camera.top",
      }),
    ).toThrow(expect.objectContaining({ code: SPATIAL_CLASSROOM_HOST_ERROR_CODES.commandIdReused }));

    const bundle = await createSpatialClassroomReplayBundle(page, host);
    const tampered = structuredClone(bundle.snapshot);
    tampered.state.cameraBookmarkId = "camera.top";
    await expect(verifySpatialRuntimeSnapshot(page, tampered)).rejects.toMatchObject({
      code: SPATIAL_CLASSROOM_HOST_ERROR_CODES.snapshotHashMismatch,
    });

    const gap = structuredClone(bundle);
    gap.commands[0].sequence = 2;
    expect(() => parseSpatialReplayBundle(gap)).toThrow();
    await expect(resumeSpatialClassroomHost(page, bundle, student)).rejects.toMatchObject({
      code: SPATIAL_CLASSROOM_HOST_ERROR_CODES.writerBranchMismatch,
    });
  });
});
