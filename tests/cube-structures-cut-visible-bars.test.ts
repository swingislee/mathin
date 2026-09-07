import { describe, expect, it, vi } from "vitest";
import { Box3, OrthographicCamera, Raycaster, Vector2, Vector3 } from "three";
import type { Axis } from "@/features/spatial-math/domain";
import { buildVoxelEdgeInstances } from "@/features/spatial-math/renderer-r3f/voxel-visual-model";
import { buildCubeStructureRenderModel, createCubeHistory } from "@/features/tools/spatial-lab/cube-structures-contract";
import { bindCubeCutPicking } from "@/features/tools/spatial-lab/cube-structures-cut-controller";
import { EMPTY_CUBE_CUT, chooseCubeCut, type CubeCutDraft } from "@/features/tools/spatial-lab/cube-structures-cut-interaction";
import { buildCubeCutGeometry, pickCubeCut } from "@/features/tools/spatial-lab/cube-structures-cut-picking";
import { createSpatialLabPresetDraft, SPATIAL_LAB_PRESET_ID } from "@/features/tools/spatial-lab/preset";

const state = createCubeHistory(createSpatialLabPresetDraft(SPATIAL_LAB_PRESET_ID).model.cells).initial;
const model = buildCubeStructureRenderModel(state, [], "Edges");
const geometry = buildCubeCutGeometry(state);
const size = { width: 1100, height: 825 };

function cameraAtZoom(zoom: number) {
  const halfHeight = model.bounds.radius * 1.35; const pose = model.camera;
  const halfWidth = halfHeight * size.width / size.height;
  const camera = new OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.01, 1000);
  camera.zoom = zoom;
  camera.position.set(pose.position.x, pose.position.y, pose.position.z);
  camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return camera;
}

function pointerBeside(point: Vector3, axis: Axis, pixelOffset: number, camera: OrthographicCamera) {
  const project = (p: Vector3) => {
    const ndc = p.clone().project(camera);
    return { x: (ndc.x + 1) * size.width / 2, y: (1 - ndc.y) * size.height / 2 };
  };
  const pointer = project(point); const other = point.clone(); other[axis] += 1;
  const end = project(other); const dx = end.x - pointer.x; const dy = end.y - pointer.y;
  const length = Math.hypot(dx, dy);
  return { x: pointer.x - dy / length * pixelOffset, y: pointer.y + dx / length * pixelOffset };
}

describe("visible rendered cut bars", () => {
  it.each([1, 2, 4])("selects visible bar surfaces, including off-center pixels at zoom %s", (zoom) => {
    const camera = cameraAtZoom(zoom); const raycaster = new Raycaster(); const entry = new Vector3();
    // 从实际绘制实例独立取样，避免只验证数学中心线而遗漏放大后的棱边表面。
    const groups = buildVoxelEdgeInstances(model.cells);
    const bars = (["x", "y", "z"] as const).flatMap((axis) => groups[axis].map((bar) => ({ axis, ...bar,
      box: new Box3().setFromCenterAndSize(new Vector3(bar.center.x, bar.center.y, bar.center.z), new Vector3(bar.scale.x, bar.scale.y, bar.scale.z)) })));
    const misses: unknown[] = []; let visible = 0;
    for (const bar of bars) for (const t of [-0.49, -0.25, 0, 0.25, 0.49]) for (const pixelOffset of [-12, -6, 0, 6, 12]) {
      const point = new Vector3(bar.center.x, bar.center.y, bar.center.z);
      point[bar.axis] += t;
      const pointer = pointerBeside(point, bar.axis, pixelOffset, camera);
      if (pointer.x < 0 || pointer.y < 0 || pointer.x > size.width || pointer.y > size.height) continue;
      raycaster.setFromCamera(new Vector2(pointer.x / size.width * 2 - 1, 1 - pointer.y / size.height * 2), camera);
      const ray = raycaster.ray;
      const distance = (box: Box3) => ray.intersectBox(box, entry) ? entry.distanceTo(ray.origin) : Infinity;
      const faceDepth = Math.min(...geometry.cells.map((cell) => distance(cell.box)));
      const barDepth = distance(bar.box);
      if (!Number.isFinite(barDepth) || barDepth >= faceDepth - 1e-5) continue;
      visible++;
      const hit = pickCubeCut(geometry, "auto", pointer, camera, size);
      if (hit?.kind !== "edge") misses.push({ key: bar.key, t, pixelOffset, point: point.toArray(), hit, barDepth, faceDepth });
    }
    expect(visible).toBeGreaterThan(0);
    expect(misses.length, JSON.stringify({ visible, missCount: misses.length, misses: misses.slice(0, 3) })).toBe(0);
  });

  it("uses the same visible bar for pointer hover and the retained first-line click", () => {
    class Surface extends EventTarget {
      ownerDocument = Object.assign(new EventTarget(), { defaultView: new EventTarget() });
      getBoundingClientRect() { return { ...size, left: 83, top: 127, right: 1183, bottom: 952 }; }
    }
    const canvas = new Surface(); const camera = cameraAtZoom(4);
    const pointer = pointerBeside(new Vector3(0.49, 0.5, 1.5), "x", 12, camera);
    const onHover = vi.fn(); let draft: CubeCutDraft = EMPTY_CUBE_CUT;
    const onPick = vi.fn((hit) => { draft = chooseCubeCut(state, state.cubes.map((cube) => cube.id), draft, hit); });
    const dispose = bindCubeCutPicking(canvas as unknown as HTMLCanvasElement, () => ({ state, onHover, onPick }), () => camera);
    try {
      for (const type of ["pointermove", "pointerdown", "pointerup"]) {
        const event = Object.assign(new Event(type, { cancelable: true }), {
          clientX: pointer.x + 83, clientY: pointer.y + 127, pointerId: 1, button: 0,
          buttons: type === "pointerdown" ? 1 : 0, isPrimary: true, pointerType: "mouse",
        });
        Object.defineProperty(event, "target", { value: canvas });
        (type === "pointerdown" ? canvas : canvas.ownerDocument).dispatchEvent(event);
      }
      expect(onHover).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledExactlyOnceWith(onHover.mock.calls[0][0]);
      expect(onHover.mock.calls[0][0]).toMatchObject({ kind: "edge" });
      expect(draft).toMatchObject({ firstLine: onHover.mock.calls[0][0].line, face: null, selection: null, issue: null });
    } finally {
      dispose();
    }
  });
});
