import { describe, expect, it } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { spatialToolbarFootprint, spatialToolbarPlacement } from "@/features/tools/spatial-interaction/toolbar-placement";
import { unitCubeCorners } from "@/features/tools/spatial-interaction/rolling";
import { spatialRigidPoint } from "@/features/tools/spatial-interaction/rigid-geometry";
import { SOMA_IDS, somaDefinition } from "@/features/tools/soma-cube/pieces";

const size = { width: 800, height: 600 }, toolbar = { width: 224, height: 54 }, origin = { x: 0, y: 0, z: 0 };
const cameraAt = (position: readonly number[], perspective = false) => {
  const camera = perspective ? new PerspectiveCamera(40, 4 / 3, 0.1, 100) : new OrthographicCamera(-7, 7, 5.25, -5.25, 0.1, 100);
  camera.position.set(...position as [number, number, number]); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); return camera;
};

describe("shared object toolbar screen-space clearance", () => {
  it.each([false, true])("avoids every Soma shape and lift handle across views (perspective=%s)", (perspective) => {
    for (const id of SOMA_IDS) for (const view of [[7, 8, 10], [0, 14, 0], [0, -14, 0], [0, 0, 14], [14, 0, 0], [-14, 3, -5]]) {
      const camera = cameraAt(view, perspective);
      const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.47).toArray() as [number, number, number, number];
      const vertices = unitCubeCorners(somaDefinition(id).cells).map((p) => spatialRigidPoint(p, { id, position: origin, quaternion: q }));
      const handles = { center: { x: 0.5, y: 0.5, z: 0 }, axes: ["y"] as const };
      const footprint = spatialToolbarFootprint(vertices, handles, camera, size)!;
      const position = spatialToolbarPlacement(footprint, size, toolbar)!;
      expect(position).not.toBeNull();
      const left = position.x - toolbar.width / 2, right = position.x + toolbar.width / 2;
      const top = position.y - toolbar.height / 2, bottom = position.y + toolbar.height / 2;
      expect(right <= footprint.left || left >= footprint.right || bottom <= footprint.top || top >= footprint.bottom).toBe(true);
      expect(left).toBeGreaterThanOrEqual(8); expect(right).toBeLessThanOrEqual(size.width - 56);
      expect(top).toBeGreaterThanOrEqual(56); expect(bottom).toBeLessThanOrEqual(size.height - 56);
      const tip = new Vector3(0.5, 2.1, 0).project(camera);
      const x = (tip.x + 1) * size.width / 2, y = (1 - tip.y) * size.height / 2;
      expect(x >= left - 22 && x <= right + 22 && y >= top - 22 && y <= bottom + 22).toBe(false);
    }
  });
  it("uses measured icon/expanded widths and keeps a clear side stable", () => {
    const footprint = { left: 180, top: 76, right: 340, bottom: 410 };
    const small = spatialToolbarPlacement(footprint, size, { width: 54, height: 54 })!;
    expect(small.side).toBe("left");
    const full = spatialToolbarPlacement(footprint, size, toolbar, small.side)!;
    expect(full.side).toBe("right"); expect(full.x - toolbar.width / 2).toBeGreaterThan(footprint.right);
    const shifted = spatialToolbarPlacement({ ...footprint, top: 260 }, size, toolbar, full.side)!;
    expect(shifted.side).toBe("right");
  });
  it("never clamps the toolbar back onto a model that fills the viewport", () => {
    expect(spatialToolbarPlacement({ left: 0, top: 0, right: 780, bottom: 600 }, size, toolbar)).toBeNull();
    expect(spatialToolbarPlacement({ left: -800, top: 100, right: -600, bottom: 300 }, size, toolbar)).toBeNull();
    expect(spatialToolbarPlacement({ left: 120, top: 140, right: 190, bottom: 210 }, { width: 260, height: 195 }, toolbar)).toBeNull();
  });
  it("places a horizontal context bar on the opposite side before moving over the column", () => {
    const position = spatialToolbarPlacement({ left: 460, right: 540, top: 230, bottom: 300 }, size, { width: 224, height: 44 }, "right")!;
    expect(position.side).toBe("left");
    expect(position.x + 112).toBeLessThan(460);
    expect(position.y).toBe(265);
  });
  it("accounts for zoom and leaves no shortcut for geometry behind the camera", () => {
    const vertices = unitCubeCorners([origin]), c = cameraAt([0, 0, 10]);
    const handles = { center: origin, axes: [] as const };
    const before = spatialToolbarFootprint(vertices, handles, c, size)!;
    c.zoom = 2; c.updateProjectionMatrix();
    const after = spatialToolbarFootprint(vertices, handles, c, size)!;
    expect(after.right - after.left - 52).toBeCloseTo(2 * (before.right - before.left - 52));
    expect(spatialToolbarFootprint(unitCubeCorners([{ x: 0, y: 0, z: 20 }]), handles, c, size)).toBeNull();
  });
  it("slides along the same side to leave a label readable", () => {
    const target = { left: 220, top: 240, right: 480, bottom: 380 };
    const bar = { width: 100, height: 44 }, label = { left: 365, top: 140, right: 460, bottom: 220 };
    const position = spatialToolbarPlacement(target, size, bar, "top", [label])!;
    expect(position.side).toBe("top");
    expect(position.x).toBeLessThan(350);
    expect(position.x + bar.width / 2 + 12).toBeLessThanOrEqual(label.left);
    expect(position.x).toBeGreaterThanOrEqual(target.left);
  });
  it("switches sides for neighbouring models and collapses only if every side is blocked", () => {
    const target = { left: 280, top: 260, right: 430, bottom: 360 };
    const above = { left: 0, top: 0, right: 800, bottom: 245 };
    expect(spatialToolbarPlacement(target, size, toolbar, "top", [above])!.side).toBe("left");
    expect(spatialToolbarPlacement(target, size, toolbar, "top", [{ left: 0, top: 0, right: 800, bottom: 600 }])).toBeNull();
    expect(spatialToolbarPlacement(target, size, { width: NaN, height: 44 })).toBeNull();
  });
  it("keeps every returned layout clear of models and panels across narrow/large stages", () => {
    for (const width of [360, 800, 1200]) for (const height of [270, 600, 900]) {
      const target = { left: width * .3, right: width * .5, top: height * .4, bottom: height * .6 };
      const blockers = [{ left: width * .6, right: width, top: 70, bottom: height - 60 },
        { left: width * .15, right: width * .45, top: height * .2, bottom: height * .3 }];
      const p = spatialToolbarPlacement(target, { width, height }, toolbar, "top", blockers);
      if (!p) continue;
      for (const rect of [target, ...blockers]) expect(p.x + 112 <= rect.left || p.x - 112 >= rect.right || p.y + 27 <= rect.top || p.y - 27 >= rect.bottom).toBe(true);
    }
  });
});
