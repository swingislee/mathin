import { describe, expect, it } from "vitest";
import {
  POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES,
  POLYHEDRON_FOLD_SIMULATION_VERSION,
  analyzePolyhedronFoldSimulation,
  computePolyhedronFoldFrame,
  parsePolyhedronFoldSimulationRequest,
  parsePolyhedronNetLayout,
} from "@/features/spatial-math/domain";
import {
  cubeGeometry,
  cubeHingeGraph,
  cubeTopology,
  cubeUnitNetLayout,
} from "./fixtures/spatial-polyhedron-cube";

function request(sampleProgressMillionths: readonly number[] = [0, 250_000, 500_000, 750_000, 1_000_000]) {
  return parsePolyhedronFoldSimulationRequest({
    simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
    sampleProgressMillionths,
    closureToleranceMicrounits: 5,
  });
}

function issueCodes(result: ReturnType<typeof analyzePolyhedronFoldSimulation>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

describe("polyhedron-fold-simulation-v1 request", () => {
  it("requires strict ascending endpoint-complete samples and bounded closure tolerance", () => {
    const valid = request();
    expect(parsePolyhedronFoldSimulationRequest(valid)).toEqual(valid);
    expect(() => parsePolyhedronFoldSimulationRequest({ ...valid, unexpected: true })).toThrow();
    expect(() =>
      parsePolyhedronFoldSimulationRequest({ ...valid, sampleProgressMillionths: [1, 1_000_000] }),
    ).toThrow();
    expect(() =>
      parsePolyhedronFoldSimulationRequest({ ...valid, sampleProgressMillionths: [0, 500_000, 500_000, 1_000_000] }),
    ).toThrow();
    expect(() =>
      parsePolyhedronFoldSimulationRequest({ ...valid, sampleProgressMillionths: [0, 500_000] }),
    ).toThrow();
    expect(() =>
      parsePolyhedronFoldSimulationRequest({
        ...valid,
        sampleProgressMillionths: Array.from({ length: 102 }, (_, index) =>
          Math.round((index * 1_000_000) / 101),
        ),
      }),
    ).toThrow();
    expect(() => parsePolyhedronFoldSimulationRequest({ ...valid, closureToleranceMicrounits: 0 })).toThrow();
  });
});

describe("polyhedron-fold-simulation-kernel-v1", () => {
  it("derives signed target angles and closes a cube through deterministic hierarchical transforms", () => {
    const topology = cubeTopology();
    const geometry = cubeGeometry();
    const hinges = cubeHingeGraph();
    const layout = cubeUnitNetLayout();
    const first = analyzePolyhedronFoldSimulation(topology, geometry, hinges, layout, request());
    const second = analyzePolyhedronFoldSimulation(topology, geometry, hinges, layout, request());

    expect(first).toEqual(second);
    expect(first.passesSampledValidation).toBe(true);
    expect(first.collisionEvidence).toBe("deterministic-samples-only");
    expect(first.issues).toEqual([]);
    expect(first.frames).toHaveLength(5);
    expect(first.frames.every((frame) => frame.collisionPairs.length === 0)).toBe(true);
    expect(first.targetAngles.map((angle) => angle.expectedSignedAngleMicrodegrees)).toEqual([
      -90_000_000,
      90_000_000,
      90_000_000,
      -90_000_000,
      90_000_000,
    ]);
    expect(first.targetAngles.every((angle) => angle.deltaMicrodegrees === 0)).toBe(true);
    expect(first.finalClosure).toEqual({
      closedWithinTolerance: true,
      toleranceMicrounits: 5,
      maximumVertexErrorMicrounits: 0,
      faces: expect.arrayContaining([
        { faceId: "face.x.neg", maximumVertexErrorMicrounits: 0 },
        { faceId: "face.z.neg", maximumVertexErrorMicrounits: 0 },
        { faceId: "face.z.pos", maximumVertexErrorMicrounits: 0 },
      ]),
    });

    const directFrame = computePolyhedronFoldFrame(topology, geometry, hinges, layout, 500_000);
    expect(directFrame).toEqual(first.frames[2]);
    expect(directFrame.faces.find((face) => face.faceId === "face.z.pos")?.transformMatrix).toEqual(
      first.frames[0].faces.find((face) => face.faceId === "face.z.pos")?.transformMatrix,
    );
  });

  it("reports wrong mountain/valley senses and target angles without accepting the final shell", () => {
    const wrongSense = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      cubeGeometry(),
      cubeHingeGraph({ allValley: true }),
      cubeUnitNetLayout(),
      request(),
    );
    expect(issueCodes(wrongSense)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.targetAngleMismatch);
    expect(issueCodes(wrongSense)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.finalClosureMismatch);
    expect(wrongSense.passesSampledValidation).toBe(false);
    expect(wrongSense.finalClosure?.maximumVertexErrorMicrounits).toBeGreaterThan(1_000_000);

    const wrongAngle = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      cubeGeometry(),
      cubeHingeGraph(),
      cubeUnitNetLayout(60_000_000),
      request(),
    );
    expect(issueCodes(wrongAngle)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.targetAngleMismatch);
    expect(issueCodes(wrongAngle)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.finalClosureMismatch);

  });

  it("reports non-adjacent face penetration at an authored deterministic sample", () => {
    const result = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      cubeGeometry(),
      cubeHingeGraph({ allMountain: true }),
      cubeUnitNetLayout(150_000_000),
      request([0, 800_000, 850_000, 1_000_000]),
    );

    expect(issueCodes(result)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.sampledFaceCollision);
    expect(result.frames[1].collisionPairs).toEqual([]);
    expect(result.frames[2].collisionPairs).toContainEqual({ faceIds: ["face.z.neg", "face.z.pos"] });
    expect(result.passesSampledValidation).toBe(false);
  });

  it("rejects a metrically distorted net before treating its final frame as target geometry", () => {
    const layout = cubeUnitNetLayout();
    const scaledLayout = parsePolyhedronNetLayout({
      ...layout,
      faces: layout.faces.map((face) => ({
        ...face,
        vertices: face.vertices.map((vertex) => ({
          ...vertex,
          position: { x: vertex.position.x * 2, y: vertex.position.y * 2 },
        })),
      })),
    });
    const result = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      cubeGeometry(),
      cubeHingeGraph(),
      scaledLayout,
      request(),
    );

    expect(issueCodes(result)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.faceMetricMismatch);
    expect(issueCodes(result)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.finalClosureMismatch);
    expect(result.passesSampledValidation).toBe(false);
  });

  it("fails closed when geometry or the planar net prerequisites are invalid", () => {
    const geometry = cubeGeometry();
    const invalidGeometry = {
      ...geometry,
      vertices: geometry.vertices.map((vertex) =>
        vertex.vertexId === "v111" ? { ...vertex, position: { ...vertex.position, z: { numerator: 2, denominator: 1 } } } : vertex,
      ),
    };
    const geometryResult = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      invalidGeometry,
      cubeHingeGraph(),
      cubeUnitNetLayout(),
      request(),
    );
    expect(geometryResult.frames).toEqual([]);
    expect(issueCodes(geometryResult)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.geometryInvalid);
    expect(() =>
      computePolyhedronFoldFrame(
        cubeTopology(),
        invalidGeometry,
        cubeHingeGraph(),
        cubeUnitNetLayout(),
        500_000,
      ),
    ).toThrow("GEOMETRY_INVALID");

    const layout = cubeUnitNetLayout();
    const invalidLayout = parsePolyhedronNetLayout({ ...layout, foldTargets: layout.foldTargets.slice(1) });
    const layoutResult = analyzePolyhedronFoldSimulation(
      cubeTopology(),
      cubeGeometry(),
      cubeHingeGraph(),
      invalidLayout,
      request(),
    );
    expect(layoutResult.frames).toEqual([]);
    expect(issueCodes(layoutResult)).toContain(POLYHEDRON_FOLD_SIMULATION_ISSUE_CODES.netLayoutInvalid);
  });
});
