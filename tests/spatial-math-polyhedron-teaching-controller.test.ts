import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInitialSpatialRuntimeState,
  forkStudentLocalRuntimeState,
  reduceSpatialRuntimeState,
  spatialCommand,
  type SpatialCommandActor,
  type SpatialCommandPayload,
  type SpatialPageDoc,
  type SpatialRuntimeState,
} from "@/features/spatial-math/domain";
import {
  POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES,
  createPolyhedronFaceAttemptDraft,
  createPolyhedronTeachingCommandIntent,
  derivePolyhedronTeachingControllerView,
  nextPolyhedronFaceSelection,
} from "@/features/spatial-math/runtime";
import { cubeFoldSpatialPage } from "./fixtures/spatial-polyhedron-scene";

const teacher: SpatialCommandActor = { kind: "teacher-controller", actorId: "teacher.001" };
const student: SpatialCommandActor = { kind: "student", actorId: "student.001" };

function applyIntent(
  page: SpatialPageDoc,
  state: SpatialRuntimeState,
  actor: SpatialCommandActor,
  payload: SpatialCommandPayload,
): SpatialRuntimeState {
  const sequence = state.lastAppliedSequence + 1;
  return reduceSpatialRuntimeState(
    page,
    state,
    spatialCommand({
      commandId: `command.${actor.kind}.${sequence}`,
      sceneRevisionHash: page.sceneHash,
      resetEpoch: state.resetEpoch,
      sequence,
      branch: state.branch,
      actor,
      payload,
    }),
  );
}

describe("polyhedron-teaching-controller-v1", () => {
  it("derives the initial 4:3 teaching view without copying authority into component state", async () => {
    const page = await cubeFoldSpatialPage();
    const state = createInitialSpatialRuntimeState(page);
    const view = derivePolyhedronTeachingControllerView(page, state, "polyhedron.cube", teacher, "en");

    expect(view).toMatchObject({
      controllerVersion: "polyhedron-teaching-controller-v1",
      entityLabel: "Cube",
      ownershipMode: "teacher-follow",
      cameraId: "camera.front",
      progress: 0,
      canManipulateScene: true,
      canSelectFaces: true,
      canSubmitFaceChoice: false,
      canReset: true,
      canGoPrevious: false,
      canGoNext: true,
    });
    expect(view.steps.map((step) => step.id)).toEqual(["step.predict", "step.explore", "step.fold", "step.verify"]);
    expect(view.activeStep).toMatchObject({ id: "step.predict", index: 0, label: "Predict" });
    expect(view.cameras.map((camera) => camera.id)).toEqual([
      "camera.front",
      "camera.perspective",
      "camera.right",
      "camera.top",
    ]);
    expect(view.faceCheckpoint).toMatchObject({
      checkpointId: "checkpoint.opposite-face",
      prompt: "Which face is opposite the front face?",
      multiple: false,
    });
    expect(view.accessibilitySummary).toContain("six squares");
    expect(view.faceLabels).toHaveLength(6);
    expect(view.faceLabels.find((face) => face.id === "face.z.neg")?.label).toBe("Back");
  });

  it("turns previous/next controls into semantic step intents and replays authored camera/fold actions", async () => {
    const page = await cubeFoldSpatialPage();
    let state = createInitialSpatialRuntimeState(page);
    for (const expected of ["step.explore", "step.fold", "step.verify"] as const) {
      const intent = createPolyhedronTeachingCommandIntent(page, state, "polyhedron.cube", teacher, {
        kind: "step.next",
      });
      if (!intent) throw new Error("fixture unexpectedly reached the final step");
      expect(intent).toEqual({ kind: "step.go", stepId: expected });
      state = applyIntent(page, state, teacher, intent);
    }

    const view = derivePolyhedronTeachingControllerView(page, state, "polyhedron.cube", teacher, "zh");
    expect(view.activeStep).toMatchObject({ id: "step.verify", durationMs: 800, easing: "ease-in-out" });
    expect(view.progress).toBe(1);
    expect(view.cameraId).toBe("camera.perspective");
    expect(view.canGoNext).toBe(false);
    expect(createPolyhedronTeachingCommandIntent(page, state, "polyhedron.cube", teacher, { kind: "step.next" })).toBeNull();

    const previous = createPolyhedronTeachingCommandIntent(page, state, "polyhedron.cube", teacher, {
      kind: "step.previous",
    });
    expect(previous).toEqual({ kind: "step.go", stepId: "step.fold" });
    state = applyIntent(page, state, teacher, previous!);
    expect(derivePolyhedronTeachingControllerView(page, state, "polyhedron.cube", teacher, "zh").progress).toBe(0.5);
  });

  it("keeps teacher-follow students read-only and opens only a matching private student branch", async () => {
    const page = await cubeFoldSpatialPage();
    const authority = createInitialSpatialRuntimeState(page);
    const following = derivePolyhedronTeachingControllerView(page, authority, "polyhedron.cube", student, "zh");
    expect(following.canManipulateScene).toBe(false);
    expect(() =>
      createPolyhedronTeachingCommandIntent(page, authority, "polyhedron.cube", student, { kind: "fold.set", progress: 0.5 }),
    ).toThrow(
      expect.objectContaining({ code: POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.actorBranchMismatch }),
    );

    const opened = applyIntent(page, authority, teacher, { kind: "ownership.set", mode: "student-local-explore" });
    const local = forkStudentLocalRuntimeState(page, opened, student.actorId);
    const localView = derivePolyhedronTeachingControllerView(page, local, "polyhedron.cube", student, "zh");
    expect(localView).toMatchObject({
      ownershipMode: "student-local-explore",
      canManipulateScene: true,
      canSelectFaces: true,
      canSubmitFaceChoice: false,
      canReset: false,
    });
    expect(createPolyhedronTeachingCommandIntent(page, local, "polyhedron.cube", student, {
      kind: "camera.apply",
      cameraId: "camera.top",
    })).toEqual({ kind: "camera.bookmark.apply", cameraId: "camera.top" });
  });

  it("keeps face choice local until the student-submit adapter emits an attempt draft", async () => {
    const page = await cubeFoldSpatialPage();
    const authority = createInitialSpatialRuntimeState(page);
    const opened = applyIntent(page, authority, teacher, { kind: "ownership.set", mode: "student-submit" });
    const local = forkStudentLocalRuntimeState(page, opened, student.actorId);
    const view = derivePolyhedronTeachingControllerView(page, local, "polyhedron.cube", student, "zh");

    expect(view.canSubmitFaceChoice).toBe(true);
    const selected = nextPolyhedronFaceSelection(view, [], "face.z.neg");
    expect(selected).toEqual(["face.z.neg"]);
    expect(createPolyhedronFaceAttemptDraft(view, selected)).toEqual({
      checkpointId: "checkpoint.opposite-face",
      response: { kind: "choice", optionIds: ["face.z.neg"] },
    });
    expect(local.selectedEntityIds).toEqual([]);
    expect(() => nextPolyhedronFaceSelection(view, selected, "face.z.pos")).toThrow(
      expect.objectContaining({ code: POLYHEDRON_TEACHING_CONTROLLER_ERROR_CODES.selectionInvalid }),
    );
  });

  it("keeps the interaction shell 4:3-first and commits only slider endpoints as command intents", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/spatial-math/renderer-r3f/PolyhedronFoldTeachingStage.tsx"),
      "utf8",
    );
    expect(source).toContain('data-layout-profile="standard-4x3"');
    expect(source).toContain('className={cn(\n        "relative aspect-[4/3]');
    expect(source).toContain("<Slider");
    expect(source).toContain("onValueChange=");
    expect(source).toContain("onValueCommit=");
    expect(source).toContain("onCommandIntent(payload)");
    expect(source).toContain('controlsLayout = "overlay"');
    expect(source).toContain('data-controls-layout="external"');
    expect(source).toContain("selectableFaceIds={selectableFaceIds}");
    expect(source).toContain('aria-valuetext={messages.formatProgress(visibleProgressPercent)}');
    expect(source).toContain('aria-live="polite"');
    expect(source).not.toContain("session_events");
    expect(source).not.toContain("<input");
  });
});
