import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVoxelCountingPage, voxelKey } from "@/features/spatial-math/domain";
import {
  applyVoxelTemplateEditorAction,
  createVoxelTemplateEditorState,
  deriveVoxelTemplateEditorView,
  voxelTemplateAdapterInput,
  voxelTemplateGridCoordinate,
  VOXEL_TEMPLATE_EDITOR_ERROR_CODES,
} from "@/features/spatial-math/editor";
import { voxelCountingAdapterInput } from "./fixtures/spatial-voxel-scene";

describe("voxel-template-editor-v1", () => {
  it("maps a layer grid to stable voxel coordinates without exposing 3D coordinate entry", () => {
    expect(voxelTemplateGridCoordinate("y", 2, 3, 4)).toEqual({ x: 3, y: 2, z: 4 });
    expect(voxelTemplateGridCoordinate("x", 2, 3, 4)).toEqual({ x: 2, y: 4, z: 3 });
    expect(voxelTemplateGridCoordinate("z", 2, 3, 4)).toEqual({ x: 3, y: 4, z: 2 });

    const view = deriveVoxelTemplateEditorView(createVoxelTemplateEditorState(voxelCountingAdapterInput()));
    expect(view).toMatchObject({
      editorVersion: "voxel-template-editor-v1",
      layerAxis: "y",
      horizontalAxis: "x",
      verticalAxis: "z",
      activeLayer: 0,
      totalCount: 10,
      activeLayerCount: 6,
      canUndo: false,
      canRedo: false,
      isDirty: false,
    });

    const inspectedLayer = applyVoxelTemplateEditorAction(
      createVoxelTemplateEditorState(voxelCountingAdapterInput()),
      { kind: "layer.select", coordinate: 2 },
    );
    expect(deriveVoxelTemplateEditorView(inspectedLayer)).toMatchObject({ activeLayer: 2, isDirty: false });
  });

  it("adds and removes cubes on the selected layer while keeping canonical order", () => {
    let state = createVoxelTemplateEditorState(voxelCountingAdapterInput());
    state = applyVoxelTemplateEditorAction(state, { kind: "layer.select", coordinate: 3 });
    state = applyVoxelTemplateEditorAction(state, { kind: "cell.toggle", u: 4, v: 4 });
    expect(state.draft.cells.at(-1)).toEqual({ x: 4, y: 3, z: 4 });
    expect(new Set(state.draft.cells.map(voxelKey)).size).toBe(11);

    state = applyVoxelTemplateEditorAction(state, { kind: "cell.toggle", u: 4, v: 4 });
    expect(state.draft.cells).toHaveLength(10);
    expect(state.draft.cells.map(voxelKey)).not.toContain("4,3,4");
  });

  it("keeps one cube as the minimum publishable model and rejects out-of-bounds layers", () => {
    const input = { ...voxelCountingAdapterInput(), cells: [{ x: 0, y: 0, z: 0 }] };
    const state = createVoxelTemplateEditorState(input);
    expect(() => applyVoxelTemplateEditorAction(state, { kind: "cell.toggle", u: 0, v: 0 })).toThrow(
      expect.objectContaining({ code: VOXEL_TEMPLATE_EDITOR_ERROR_CODES.lastCellRequired }),
    );
    expect(() => applyVoxelTemplateEditorAction(state, { kind: "layer.select", coordinate: 20 })).toThrow(
      expect.objectContaining({ code: VOXEL_TEMPLATE_EDITOR_ERROR_CODES.layerOutOfBounds }),
    );
  });

  it("undoes, redoes and resets authored axis and cell changes", () => {
    let state = createVoxelTemplateEditorState(voxelCountingAdapterInput());
    state = applyVoxelTemplateEditorAction(state, { kind: "axis.select", axis: "z" });
    state = applyVoxelTemplateEditorAction(state, { kind: "cell.toggle", u: 4, v: 4 });
    expect(deriveVoxelTemplateEditorView(state)).toMatchObject({ totalCount: 11, layerAxis: "z", canUndo: true });

    state = applyVoxelTemplateEditorAction(state, { kind: "history.undo" });
    expect(deriveVoxelTemplateEditorView(state)).toMatchObject({ totalCount: 10, layerAxis: "z", canRedo: true });
    state = applyVoxelTemplateEditorAction(state, { kind: "history.undo" });
    expect(deriveVoxelTemplateEditorView(state).layerAxis).toBe("y");
    state = applyVoxelTemplateEditorAction(state, { kind: "history.redo" });
    expect(deriveVoxelTemplateEditorView(state).layerAxis).toBe("z");
    state = applyVoxelTemplateEditorAction(state, { kind: "draft.reset" });
    expect(deriveVoxelTemplateEditorView(state)).toMatchObject({ totalCount: 10, layerAxis: "y", isDirty: false });
  });

  it("materializes the same deterministic 1200x900 page used by the teaching runtime", async () => {
    let state = createVoxelTemplateEditorState(voxelCountingAdapterInput());
    state = applyVoxelTemplateEditorAction(state, { kind: "cell.toggle", u: 4, v: 4 });
    const input = voxelTemplateAdapterInput(state);
    const first = await buildVoxelCountingPage(input);
    const second = await buildVoxelCountingPage(input);

    expect(first.page.layout).toEqual({ profile: "standard-4x3" });
    expect(first.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
    expect(first.page.sceneHash).toBe(second.page.sceneHash);
    expect(first.page.scene.model.entities[0]).toMatchObject({ type: "voxel-set" });
    expect(first.totalCount).toBe(11);
  });

  it("keeps the editor as a preproduction client leaf with shadcn controls and one 4:3 preview", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/spatial-math/editor/VoxelTemplateEditorStage.tsx"),
      "utf8",
    );
    expect(source).toContain('data-spatial-editor="voxel-template-editor-v1"');
    expect(source).toContain('data-editor-preview="standard-4x3"');
    expect(source).toContain("<Button");
    expect(source).toContain("<Card");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("wide-16x9-exception");
    expect(source).not.toContain("session_events");
    expect(source).not.toContain("supabase");
  });
});
