import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrthographicCamera, Vector3 } from "three";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { CUBE_NET_FACE_REVEAL_DISTANCE, CUBE_NET_FACE_REVEAL_MS, cubeNetRevealFaces, cubeNetFaceArrowAngle, revealCubeNetFaces, sampleCubeNetFaceReveal } from "@/features/tools/spatial-lab/cube-net-face-reveal";

describe("independent face-reveal observation", () => {
  it("moves only the requested face outwards, preserves opposite directions and restores exact cube geometry", async () => {
    for (const entry of createCubeNetGalleryCatalog().entries.filter((item) => item.classification === "legal")) {
      const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
      const angles = Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]));
      const closed = createCubeNetWorkbenchResolver(build, "zh").resolve(angles).model;
      const original = JSON.stringify(closed);
      const arrows = cubeNetRevealFaces(closed, {});
      expect(arrows).toHaveLength(6);
      for (const arrow of arrows) {
        expect(arrow.direction.length()).toBeCloseTo(1);
        expect(arrow.position.clone().sub(arrow.center).cross(arrow.normal).length()).toBeCloseTo(0);
        expect(arrow.position.distanceTo(arrow.center)).toBeGreaterThanOrEqual(0.89);
        expect(arrow.normal.dot(arrow.center.clone().sub(new Vector3(closed.bounds.center.x, closed.bounds.center.y, closed.bounds.center.z)))).toBeGreaterThan(0);
        expect(arrows.filter((other) => arrow.direction.dot(other.direction) < -0.99)).toHaveLength(1);
        const offsets = { [arrow.faceId]: 1 };
        const moved = revealCubeNetFaces(closed, offsets);
        for (const face of moved.faces) {
          const before = closed.faces.find((item) => item.faceId === face.faceId)!;
          const distance = face.faceId === arrow.faceId ? CUBE_NET_FACE_REVEAL_DISTANCE : 0;
          face.vertices.forEach((vertex, index) => {
            const initial = before.vertices[index].position;
            expect(vertex.position.x - initial.x).toBeCloseTo(arrow.normal.x * distance);
            expect(vertex.position.y - initial.y).toBeCloseTo(arrow.normal.y * distance);
            expect(vertex.position.z - initial.z).toBeCloseTo(arrow.normal.z * distance);
          });
          expect(face.label).toBe(before.label);
        }
        const reverse = cubeNetRevealFaces(closed, offsets).find((face) => face.faceId === arrow.faceId)!;
        expect(reverse.direction.dot(arrow.direction)).toBeCloseTo(-1);
        const midpoint = sampleCubeNetFaceReveal({}, offsets, CUBE_NET_FACE_REVEAL_MS / 2);
        expect(midpoint[arrow.faceId]).toBe(0.5);
        expect(sampleCubeNetFaceReveal({}, offsets, CUBE_NET_FACE_REVEAL_MS)).toEqual(offsets);
        const restored = revealCubeNetFaces(closed, sampleCubeNetFaceReveal(offsets, {}, CUBE_NET_FACE_REVEAL_MS));
        expect(restored.faces).toEqual(closed.faces);
      }
      expect(JSON.stringify(closed)).toBe(original);
    }
  });
  it("is an explicit, initially-off right-toolbar toggle and keeps observation separate from cutting", () => {
    const source = readFileSync(resolve("src/features/tools/spatial-lab/CubeNetFoldWorkspace.tsx"), "utf8");
    expect(source).toContain("[revealEnabled, setRevealEnabled] = useState(false)");
    expect(source).toContain("data-cube-net-face-reveal-toggle");
    expect(source).toContain("onClick={toggleReveal}");
    expect(source).toContain('onCutToggle={tool === "cut" && !busy && !revealEnabled ? toggleCut : undefined}');
    expect(source).toContain("closeReveal(() => void unfoldCuts(selection))");
    const rightTools = source.slice(source.indexOf('data-cube-tools-toolbar'), source.indexOf('{panel === "settings" &&'));
    expect(rightTools).toContain('data-cube-net-gallery-toggle');
    const arrows = readFileSync(resolve("src/features/tools/spatial-lab/CubeNetFaceArrows.tsx"), "utf8");
    expect(arrows).toContain('<Html position={face.position} center occlude');
    expect(arrows).toContain('className="relative h-12 w-12');
    expect(arrows).toContain('onMove?.(face.faceId)');
    expect(arrows).not.toMatch(/coneGeometry|cylinderGeometry|<span|<line|calculatePosition/);
  });
  it("projects arrow directions from centered 3D anchors and reverses them for restoration", async () => {
    const entry = createCubeNetGalleryCatalog().entries.find((item) => item.classification === "legal")!;
    const build = await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id));
    const closed = createCubeNetWorkbenchResolver(build, "zh").resolve(Object.fromEntries(build.sceneInput.hingeGraph.hinges.map((hinge) => [hinge.edgeId, 90]))).model;
    const center = new Vector3(closed.bounds.center.x, closed.bounds.center.y, closed.bounds.center.z);
    for (const [width, height] of [[800, 600], [390, 293]]) for (const direction of [[5, 4, 6], [-5, 4, -6], [0, 0, 6], [0, 6, 0]]) {
      const camera = new OrthographicCamera(-3 * width / height, 3 * width / height, 3, -3, 0.1, 100);
      camera.position.copy(center).add(new Vector3(...direction)); camera.lookAt(center); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      for (const face of cubeNetRevealFaces(closed, {})) {
        const angle = cubeNetFaceArrowAngle(face, camera, width, height);
        expect(Number.isFinite(angle)).toBe(true);
        expect(cubeNetFaceArrowAngle({ ...face, expanded: true }, camera, width, height) - angle).toBeCloseTo(180);
      }
    }
  });
});
