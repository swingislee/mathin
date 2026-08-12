import { beforeAll, describe, expect, it } from "vitest";
import {
  CUBE_NET_GALLERY_FOLDING_ERROR_CODES,
  CUBE_NET_GALLERY_FOLDING_VERSION,
  CUBE_NET_GALLERY_VERSION,
  buildCubeNetFoldingPreset,
  buildCubeNetGalleryFolding,
  canonicalSha256,
  createCubeNetFoldingPresetRequest,
  createCubeNetGalleryCatalog,
  createCubeNetGalleryFoldingRequest,
  parseCubeNetGalleryFoldingRequest,
  resolvePolyhedronFoldFrameFromScene,
  squareCellKey,
  type CubeFaceDirection,
  type CubeNetGalleryFoldingBuild,
} from "@/features/spatial-math/domain";

const FACE_ID_BY_DIRECTION: Readonly<Record<CubeFaceDirection, string>> = {
  "x-": "face.x.neg",
  "x+": "face.x.pos",
  "y-": "face.y.neg",
  "y+": "face.y.pos",
  "z-": "face.z.neg",
  "z+": "face.z.pos",
};

describe("cube-net-gallery-folding-v1", () => {
  let builds: readonly CubeNetGalleryFoldingBuild[];

  beforeAll(async () => {
    const legalEntries = createCubeNetGalleryCatalog().entries.filter(
      (entry) => entry.classification === "legal",
    );
    const collected: CubeNetGalleryFoldingBuild[] = [];
    for (const entry of legalEntries) {
      collected.push(await buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(entry.id)));
    }
    builds = collected;
  });

  it("accepts only a strict request bound to the gallery and folding versions", () => {
    const request = createCubeNetGalleryFoldingRequest("cube-net-gallery.02");
    expect(request).toEqual({
      foldingVersion: CUBE_NET_GALLERY_FOLDING_VERSION,
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: "cube-net-gallery.02",
    });
    expect(parseCubeNetGalleryFoldingRequest(request)).toEqual(request);
    expect(() => parseCubeNetGalleryFoldingRequest({ ...request, unexpected: true })).toThrow();
    expect(() => parseCubeNetGalleryFoldingRequest({ ...request, foldingVersion: "v2" })).toThrow();
    expect(() => parseCubeNetGalleryFoldingRequest({ ...request, galleryVersion: "v2" })).toThrow();
  });

  it("compiles all 11 legal gallery entries into distinct validated fold artifacts", () => {
    expect(builds).toHaveLength(11);
    expect(new Set(builds.map((build) => build.entry.id)).size).toBe(11);
    expect(new Set(builds.map((build) => build.sceneBuild.sceneHash)).size).toBe(11);
    for (const build of builds) {
      expect(build.entry.classification).toBe("legal");
      expect(build.sceneBuild.folding.hingeGraph.hinges).toHaveLength(5);
      expect(build.sceneBuild.folding.layout.foldTargets).toHaveLength(5);
      expect(build.sceneBuild.folding.validation).toMatchObject({
        passesSampledValidation: true,
        collisionEvidence: "deterministic-samples-only",
        finalClosure: { maximumVertexErrorMicrounits: 0 },
      });
      expect(build.sceneBuild.folding.validation.targetAngles).toHaveLength(5);
    }
  });

  it("maps every canonical square to the semantic cube face from the kernel orientation", () => {
    for (const build of builds) {
      const cellByFaceId = new Map(build.sceneInput.layout.faces.map((face) => {
        const xs = face.vertices.map((vertex) => vertex.position.x);
        const ys = face.vertices.map((vertex) => vertex.position.y);
        return [face.faceId, { x: Math.min(...xs), y: Math.min(...ys) }] as const;
      }));
      expect(
        build.analysis.faces.map((placement) => ({
          faceId: FACE_ID_BY_DIRECTION[placement.cubeFace],
          cell: cellByFaceId.get(FACE_ID_BY_DIRECTION[placement.cubeFace]),
        })),
      ).toEqual(
        build.analysis.faces.map((placement) => ({
          faceId: FACE_ID_BY_DIRECTION[placement.cubeFace],
          cell: placement.cell,
        })),
      );
      expect(new Set([...cellByFaceId.values()].map(squareCellKey))).toEqual(
        new Set(build.entry.net.cells.map(squareCellKey)),
      );
    }
  });

  it("keeps A on the root face, F opposite A, and A through F labels stable", () => {
    for (const build of builds) {
      expect(build.sceneInput.layout.rootFaceId).toBe("face.z.pos");
      expect(build.sceneInput.hingeGraph.rootFaceId).toBe("face.z.pos");
      expect(Object.fromEntries(build.sceneInput.faceLabels.map(({ faceId, label }) => [faceId, label.zh]))).toEqual({
        "face.x.neg": "B",
        "face.x.pos": "C",
        "face.y.neg": "D",
        "face.y.pos": "E",
        "face.z.neg": "F",
        "face.z.pos": "A",
      });
      const checkpoint = build.sceneBuild.scene.checkpoints[0];
      expect(checkpoint.type).toBe("choice");
      if (checkpoint.type !== "choice") throw new Error("cube-net checkpoint must be a choice");
      expect(checkpoint.correctOptionIds).toEqual(["face.z.neg"]);
    }
  });

  it("resolves open, half-folded and closed frames for every legal form", () => {
    for (const build of builds) {
      const frames = [0, 0.5, 1].map((progress) => resolvePolyhedronFoldFrameFromScene(
        build.sceneBuild.scene,
        build.sceneInput.entityId,
        progress,
      ));
      expect(frames.map((frame) => frame.faces.length)).toEqual([6, 6, 6]);
      expect(frames.every((frame) => frame.collisionPairs.length === 0)).toBe(true);
      expect(frames[2].progressMillionths).toBe(1_000_000);
    }
  });

  it("materializes one deterministic 1200 by 900 standard 4:3 page per form", async () => {
    for (const build of builds) {
      expect(build.page.layout).toEqual({ profile: "standard-4x3" });
      expect(build.page.presentation.viewport).toMatchObject({ width: 1_200, height: 900 });
      expect(build.page.source).toEqual({ kind: "scratch" });
      expect(build.page.sceneHash).toBe(build.sceneBuild.sceneHash);
    }
    const first = builds[0];
    const repeated = await buildCubeNetGalleryFolding(first.request);
    expect(repeated).toEqual(first);
    expect(await canonicalSha256(repeated.page)).toBe(await canonicalSha256(first.page));
  });

  it("rejects invalid and unknown gallery entries without changing the fixed legacy preset", async () => {
    const catalog = createCubeNetGalleryCatalog();
    const invalid = catalog.entries.find((entry) => entry.classification === "invalid");
    expect(invalid).toBeTruthy();
    await expect(buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest(invalid!.id))).rejects.toMatchObject({
      code: CUBE_NET_GALLERY_FOLDING_ERROR_CODES.invalidEntry,
    });
    await expect(buildCubeNetGalleryFolding(createCubeNetGalleryFoldingRequest("cube-net-gallery.99"))).rejects.toMatchObject({
      code: CUBE_NET_GALLERY_FOLDING_ERROR_CODES.unknownEntry,
    });
    const legacy = await buildCubeNetFoldingPreset(createCubeNetFoldingPresetRequest());
    expect(legacy.request.presetId).toBe("cube-net.cross-opposite-face.v1");
    expect(legacy.net.cells).toEqual([
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });
});
