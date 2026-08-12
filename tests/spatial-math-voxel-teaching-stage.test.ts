import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createVoxelSet,
  forkStudentLocalRuntimeState,
  projectVoxels,
  type SpatialCommandActor,
} from "@/features/spatial-math/domain";
import {
  applySpatialClassroomCommandIntent,
  createTeacherSpatialClassroomHost,
  createVoxelCountAttemptDraft,
  createVoxelTeachingCommandIntent,
  deriveVoxelTeachingControllerView,
  forkStudentSpatialClassroomHost,
  VOXEL_TEACHING_CONTROLLER_ERROR_CODES,
} from "@/features/spatial-math/runtime";
import { buildVoxelRenderModel } from "@/features/spatial-math/renderer-r3f";
import { voxelCountingSpatialPage } from "./fixtures/spatial-voxel-scene";

const teacher: SpatialCommandActor = { kind: "teacher-controller", actorId: "teacher.001" };
const student: SpatialCommandActor = { kind: "student", actorId: "student.001" };

describe("voxel-teaching-controller-v1 and 4:3 render model", () => {
  it("keeps counts hidden in prediction while materializing ten instanced cells", async () => {
    const page = await voxelCountingSpatialPage();
    const host = await createTeacherSpatialClassroomHost(page, teacher);
    const view = deriveVoxelTeachingControllerView(page, host.state, "voxel.main", teacher, "zh");
    const model = buildVoxelRenderModel(page, host.state, "voxel.main", "zh");

    expect(view).toMatchObject({
      controllerVersion: "voxel-teaching-controller-v1",
      cameraId: "camera.perspective",
      totalCount: null,
      canManipulateScene: true,
      canSubmitCount: false,
      canReset: true,
    });
    expect(view.layers.map((layer) => layer.count)).toEqual([null, null, null]);
    expect(model).toMatchObject({
      profile: "standard-4x3",
      totalCellCount: 10,
      hiddenByLayerCount: 0,
      totalCountRevealed: false,
      projectionDepthRevealed: false,
      camera: { projection: "orthographic" },
    });
    expect(model.cells).toHaveLength(10);
  });

  it("replays authored view and layer steps as semantic intents", async () => {
    const page = await voxelCountingSpatialPage();
    let host = await createTeacherSpatialClassroomHost(page, teacher);
    for (let index = 0; index < 4; index += 1) {
      const payload = createVoxelTeachingCommandIntent(page, host.state, "voxel.main", teacher, "zh", {
        kind: "step.next",
      });
      if (!payload) throw new Error("fixture ended before the first layer step");
      host = applySpatialClassroomCommandIntent(page, host, `command.teacher.step.${index + 1}`, payload).host;
    }

    const view = deriveVoxelTeachingControllerView(page, host.state, "voxel.main", teacher, "zh");
    const model = buildVoxelRenderModel(page, host.state, "voxel.main", "zh");
    expect(view.activeStep?.id).toBe("step.layer.001");
    expect(view.layers.map((layer) => [layer.visible, layer.count])).toEqual([
      [true, 6],
      [false, 3],
      [false, 1],
    ]);
    expect(model.cells).toHaveLength(6);
    expect(model.hiddenByLayerCount).toBe(4);

    const toggle = createVoxelTeachingCommandIntent(page, host.state, "voxel.main", teacher, "zh", {
      kind: "layer.toggle",
      layerId: view.layers[1].id,
    });
    expect(toggle).toEqual({ kind: "layer.set", layerId: "layer.y.c1025", visible: true });

    const verify = createVoxelTeachingCommandIntent(page, host.state, "voxel.main", teacher, "zh", {
      kind: "step.go",
      stepId: "step.verify",
    });
    if (!verify) throw new Error("verify step is missing");
    host = applySpatialClassroomCommandIntent(page, host, "command.teacher.verify", verify).host;
    expect(deriveVoxelTeachingControllerView(page, host.state, "voxel.main", teacher, "zh").totalCount).toBe(10);
    expect(buildVoxelRenderModel(page, host.state, "voxel.main", "zh").cells).toHaveLength(10);
  });

  it("uses the same exact voxel projection in the render model and domain kernel", async () => {
    const page = await voxelCountingSpatialPage();
    let host = await createTeacherSpatialClassroomHost(page, teacher);
    host = applySpatialClassroomCommandIntent(page, host, "command.teacher.front", {
      kind: "camera.bookmark.apply",
      cameraId: "camera.front",
    }).host;
    const model = buildVoxelRenderModel(page, host.state, "voxel.main", "en");
    const oracle = projectVoxels(
      createVoxelSet(model.cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z }))),
      "front",
    );
    expect(model.projectionView).toBe("front");
    expect(model.projection).toEqual(oracle);
    expect(model.projectionDepthRevealed).toBe(true);
  });

  it("emits a private numeric attempt draft while keeping the final reveal teacher-controlled", async () => {
    const page = await voxelCountingSpatialPage();
    let authority = await createTeacherSpatialClassroomHost(page, teacher);
    authority = applySpatialClassroomCommandIntent(page, authority, "command.teacher.submit", {
      kind: "ownership.set",
      mode: "student-submit",
    }).host;
    const local = await forkStudentSpatialClassroomHost(page, authority.state, student);
    const view = deriveVoxelTeachingControllerView(page, local.state, "voxel.main", student, "en");

    expect(view.totalCount).toBeNull();
    expect(view.canSubmitCount).toBe(true);
    expect(createVoxelCountAttemptDraft(view, "10")).toEqual({
      checkpointId: "checkpoint.total-count",
      response: { kind: "numeric", value: { numerator: 10, denominator: 1 } },
    });
    expect(() => createVoxelCountAttemptDraft(view, "10.5")).toThrow(
      expect.objectContaining({ code: VOXEL_TEACHING_CONTROLLER_ERROR_CODES.attemptInvalid }),
    );
    expect(() =>
      createVoxelTeachingCommandIntent(page, local.state, "voxel.main", student, "en", {
        kind: "step.go",
        stepId: "step.verify",
      }),
    ).toThrow(expect.objectContaining({ code: VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actionNotAllowed }));
  });

  it("keeps teacher-follow students read-only even if they know a valid layer id", async () => {
    const page = await voxelCountingSpatialPage();
    const authority = await createTeacherSpatialClassroomHost(page, teacher);
    const following = deriveVoxelTeachingControllerView(page, authority.state, "voxel.main", student, "zh");
    expect(following.canManipulateScene).toBe(false);
    expect(() =>
      createVoxelTeachingCommandIntent(page, authority.state, "voxel.main", student, "zh", {
        kind: "layer.toggle",
        layerId: "layer.y.c1024",
      }),
    ).toThrow(expect.objectContaining({ code: VOXEL_TEACHING_CONTROLLER_ERROR_CODES.actorBranchMismatch }));
    expect(() => forkStudentLocalRuntimeState(page, authority.state, student.actorId)).toThrow();
  });

  it("keeps the renderer lazy, instanced, recoverable and 4:3-first", () => {
    const renderer = readFileSync(resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx"), "utf8");
    const view = readFileSync(resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/VoxelView.tsx"), "utf8");
    const stage = readFileSync(resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/VoxelTeachingStage.tsx"), "utf8");

    expect(renderer).toContain("<instancedMesh");
    expect(renderer).toContain("VOXEL_SOLID_SIZE");
    expect(renderer).toContain("buildVoxelEdgeInstances");
    expect(renderer).toContain("meshBasicMaterial color={color}");
    expect(renderer).toContain("interpolateVoxelCameraPose");
    expect(renderer).toContain("snapVoxelCameraPoseToPrincipalAxis");
    expect(renderer).toContain('data-camera-transition="orbit-ease-in-out"');
    expect(renderer).toContain('data-camera-transition-state="idle"');
    expect(renderer).toContain('axisSnapEnabled = false');
    expect(renderer).toContain('data-camera-axis-snap={axisSnapEnabled ? "enabled" : "disabled"}');
    expect(renderer).toContain('data-camera-projection="orthographic-only"');
    expect(renderer).not.toContain("0.92, 0.92, 0.92");
    expect(renderer).toContain("computeBoundingSphere()");
    expect(renderer).toContain("invalidate()");
    expect(renderer).toContain('frameloop="demand"');
    expect(renderer).toContain('dpr={[1, VOXEL_RENDERER_MAX_DPR]}');
    expect(renderer).toContain('"webglcontextlost"');
    expect(renderer).toContain('"webglcontextrestored"');
    expect(view).toContain("ssr: false");
    expect(stage).toContain('data-layout-profile="standard-4x3"');
    expect(stage).toContain("<Input");
    expect(stage).toContain("<Magnet");
    expect(stage).toContain("aria-pressed={axisSnapEnabled}");
    expect(stage).toContain("onCommandIntent(payload)");
    expect(stage).not.toContain("session_events");
  });
});
