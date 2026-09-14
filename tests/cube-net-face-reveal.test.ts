import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCubeNetGalleryFolding, createCubeNetGalleryCatalog, createCubeNetGalleryFoldingRequest } from "@/features/spatial-math/domain";
import { createCubeNetWorkbenchResolver } from "@/features/tools/spatial-lab/cube-net-workbench-model";
import { CUBE_NET_FACE_REVEAL_DISTANCE, CUBE_NET_FACE_REVEAL_MS, cubeNetRevealFaces, revealCubeNetFaces, sampleCubeNetFaceReveal } from "@/features/tools/spatial-lab/cube-net-face-reveal";

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
    expect(source).toContain("closeReveal(() => void unfoldCuts())");
  });
});
