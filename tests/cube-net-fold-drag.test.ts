import { beforeAll, describe, expect, it } from "vitest";
import { OrthographicCamera, Vector3 } from "three";
import { readFileSync } from "node:fs";
import {
  buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest,
  type CubeNetGalleryFoldingBuild, type PolyhedronFoldVector3,
} from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver, frameCubeNetWorkbench } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { beginCubeNetFoldDrag, finishCubeNetFoldDrag, updateCubeNetFoldDrag } from "@/features/tools/spatial-lab/cube-net-fold-drag";
import { cubeWorkbenchCamera, CUBE_WORKBENCH_VIEWS } from "@/features/tools/spatial-lab/cube-workbench-camera";

describe("cube net direct paper gestures and shared workbench presentation", () => {
  let builds: CubeNetGalleryFoldingBuild[];
  beforeAll(async () => {
    builds = await Promise.all(createCubeNetGalleryCatalog().entries.filter((entry) => entry.classification === "legal")
      .map((entry) => buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id))));
  });

  it("places every net on a Y-up table and folds toward the same upright cube without changing source artifacts", () => {
    for (const build of builds) {
      const before = JSON.stringify(build);
      const resolver = createCubeNetWorkbenchResolver(build, "zh");
      const flat = resolver.resolve({}).model;
      expect(flat.faces.some((face) => face.selected)).toBe(false);
      expect(flat.faces.flatMap((face) => face.vertices).every((vertex) => Math.abs(vertex.position.y) < 1e-8)).toBe(true);
      const values = Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
      const folded = resolver.resolve(values).model;
      expect(folded.bounds.min.y).toBeCloseTo(0);
      expect(folded.bounds.max.y).toBeCloseTo(1);
      for (const view of CUBE_WORKBENCH_VIEWS) {
        const model = frameCubeNetWorkbench(folded, flat.bounds, view);
        expect(model.camera).toMatchObject({ ...cubeWorkbenchCamera(flat.bounds, view, "cube-net-workbench"), projection: "orthographic" });
        expect(model.displayTarget).toEqual(model.bounds.center);
        expect(model.camera.target).toEqual(flat.bounds.center);
      }
      expect(JSON.stringify(build)).toBe(before);
    }
  });

  it("maps dragging a paper point along its projected arc back to each hinge's correct angle", () => {
    for (const build of builds) {
      const resolver = createCubeNetWorkbenchResolver(build, "en");
      const flat = resolver.resolve({});
      const bookmark = cubeWorkbenchCamera(flat.model.bounds, "angle");
      const halfHeight = flat.model.bounds.radius * 1.35;
      const camera = new OrthographicCamera(-halfHeight * 4 / 3, halfHeight * 4 / 3, halfHeight, -halfHeight, 0.01, 1000);
      camera.position.set(bookmark.position.x, bookmark.position.y, bookmark.position.z);
      camera.up.set(bookmark.up.x, bookmark.up.y, bookmark.up.z);
      camera.lookAt(bookmark.target.x, bookmark.target.y, bookmark.target.z);
      camera.updateMatrixWorld();
      const project = (point: PolyhedronFoldVector3) => {
        const screen = new Vector3(point.x, point.y, point.z).project(camera);
        return { x: (screen.x + 1) * 400, y: (1 - screen.y) * 300 };
      };
      for (const hinge of flat.hinges) {
        const grabbed = flat.model.faces.find((face) => face.faceId === hinge.faceId)!.centroid;
        const pointer = project(grabbed);
        const drag = beginCubeNetFoldDrag(hinge, grabbed, 0, pointer, project)!;
        expect(drag).not.toBeNull();
        for (const degrees of [-70, -30, 30, 70, 90]) {
          const moved = resolver.resolve({ [hinge.edgeId]: degrees });
          const point = moved.model.faces.find((face) => face.faceId === hinge.faceId)!.centroid;
          expect(updateCubeNetFoldDrag(drag, project(point), 0), `${build.entry.id} ${hinge.label} ${degrees}`).toBe(degrees);
        }
        expect(updateCubeNetFoldDrag(drag, pointer, 50)).toBe(0);
        expect(beginCubeNetFoldDrag(hinge, hinge.start, 0, pointer, project)).toBeNull();
      }
    }
  });

  it("keeps top-view direction stable and snaps only near flat or square corners", () => {
    const resolver = createCubeNetWorkbenchResolver(builds[0], "zh");
    const flat = resolver.resolve({});
    const hinge = flat.hinges[0];
    const grabbed = flat.model.faces.find((face) => face.faceId === hinge.faceId)!.centroid;
    const project = (point: PolyhedronFoldVector3) => ({ x: point.x * 200, y: point.z * 200 });
    const drag = beginCubeNetFoldDrag(hinge, grabbed, 0, project(grabbed), project)!;
    const folded = resolver.resolve({ [hinge.edgeId]: 60 });
    const point = project(folded.model.faces.find((face) => face.faceId === hinge.faceId)!.centroid);
    expect(updateCubeNetFoldDrag(drag, point, 0)).toBe(60);
    expect(updateCubeNetFoldDrag(drag, point, -30)).toBe(-60);
    expect([3, -3, 87, -88, 45, -35].map(finishCubeNetFoldDrag)).toEqual([0, 0, 90, -90, 45, -35]);
  });

  it("grabs connected paper after other hinges have already folded and can unfold it again", () => {
    for (const build of builds) {
      const resolver = createCubeNetWorkbenchResolver(build, "zh");
      const values = Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge, index) => [hinge.edgeId, [30, -40, 60, 20, -25][index]]));
      const current = resolver.resolve(values);
      // 非主轴正交投影，避免两种相反方向在俯视时完全重叠。
      const project = (point: PolyhedronFoldVector3) => ({ x: (point.x - point.z * 0.6) * 150, y: (point.x * 0.3 + point.z * 0.5 - point.y) * 150 });
      for (const hinge of current.hinges) {
        const faceId = hinge.movingFaceIds.at(-1)!;
        const grabbed = current.model.faces.find((face) => face.faceId === faceId)!.centroid;
        const drag = beginCubeNetFoldDrag(hinge, grabbed, values[hinge.edgeId], project(grabbed), project);
        expect(drag).not.toBeNull();
        const unfolded = resolver.resolve({ ...values, [hinge.edgeId]: 0 });
        const target = unfolded.model.faces.find((face) => face.faceId === faceId)!.centroid;
        expect(updateCubeNetFoldDrag(drag!, project(target), values[hinge.edgeId]), `${build.entry.id} ${hinge.label}`).toBe(0);
      }
    }
  });

  it("separates paper capture from camera observation and cancels interrupted gestures", () => {
    const source = readFileSync("src/features/tools/spatial-lab/CubeNetFoldViewport.tsx", "utf8");
    expect(source).toContain('props.tool === "fold" ? "object" : props.tool');
    expect(source).toContain("cameraInteractive={!props.dragging}");
    expect(source).toContain("canvas.setPointerCapture(event.pointerId)");
    expect(source).toContain('canvas.addEventListener("pointercancel", cancelPointer)');
    expect(source).toContain('canvas.addEventListener("lostpointercapture", cancelPointer)');
    expect(source).toContain('window.addEventListener("blur", cancel)');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("if (cancel) onPreview(null)");
    expect(source).toContain("depthTest={false} depthWrite={false}");
    expect(source).toContain("doubleSidedLabels");
    const renderer = readFileSync("src/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas.tsx", "utf8");
    expect(renderer).toContain("zIndexRange={[3, 0]}");
    expect(renderer).toContain("occlude={doubleSidedLabels ? true");
  });
});
