import {
  createCubeNetFoldingPresetRequest,
  createCubeNetFoldingSceneInput,
} from "./cube-net-folding-preset";
import {
  CUBE_NET_GALLERY_FOLDING_VERSION,
  parseCubeNetGalleryFoldingRequest,
  type CubeNetGalleryFoldingRequest,
} from "./cube-net-gallery-folding-schema";
import { createCubeNetGalleryCatalog } from "./cube-net-gallery";
import {
  CUBE_NET_GALLERY_VERSION,
  type CubeNetGalleryEntry,
} from "./cube-net-gallery-schema";
import {
  analyzeCubeNet,
  type CubeFaceDirection,
  type CubeNetAnalysis,
  type IntegerVector3,
} from "./cube-net-kernel";
import {
  analyzePolyhedronFoldSimulation,
  type PolyhedronFoldSimulationAnalysis,
} from "./polyhedron-fold-simulation-kernel";
import {
  POLYHEDRON_NET_LAYOUT_VERSION,
  parsePolyhedronNetLayout,
  type PolyhedronNetLayout,
} from "./polyhedron-net-geometry-schema";
import {
  buildPolyhedronFoldScene,
  type PolyhedronFoldSceneBuildResult,
} from "./polyhedron-scene-adapter";
import {
  parsePolyhedronSceneAdapterInput,
  type PolyhedronSceneAdapterInput,
} from "./polyhedron-scene-adapter-schema";
import { analyzePolyhedronTopology } from "./polyhedron-topology-kernel";
import {
  POLYHEDRON_HINGE_GRAPH_VERSION,
  parsePolyhedronHingeGraph,
  type PolyhedronHingeGraph,
} from "./polyhedron-topology-schema";
import {
  SPATIAL_PAGE_DOC_VERSION,
  materializeSpatialPageDoc,
  type SpatialPageDoc,
} from "./page-schema";
import { squareCellKey, type SquareCell } from "./net-schema";

export const CUBE_NET_GALLERY_FOLDING_ERROR_CODES = {
  unknownEntry: "CUBE_NET_GALLERY_FOLDING_UNKNOWN_ENTRY",
  invalidEntry: "CUBE_NET_GALLERY_FOLDING_INVALID_ENTRY",
  mappingFailed: "CUBE_NET_GALLERY_FOLDING_MAPPING_FAILED",
  simulationFailed: "CUBE_NET_GALLERY_FOLDING_SIMULATION_FAILED",
  pageContract: "CUBE_NET_GALLERY_FOLDING_PAGE_CONTRACT",
} as const;

export type CubeNetGalleryFoldingErrorCode =
  (typeof CUBE_NET_GALLERY_FOLDING_ERROR_CODES)[keyof typeof CUBE_NET_GALLERY_FOLDING_ERROR_CODES];

export class CubeNetGalleryFoldingError extends Error {
  constructor(public readonly code: CubeNetGalleryFoldingErrorCode, message: string) {
    super(message);
    this.name = "CubeNetGalleryFoldingError";
  }
}

export interface CubeNetGalleryFoldingBuild {
  readonly request: CubeNetGalleryFoldingRequest;
  readonly entry: CubeNetGalleryEntry;
  readonly analysis: CubeNetAnalysis;
  readonly sceneInput: PolyhedronSceneAdapterInput;
  readonly sceneBuild: PolyhedronFoldSceneBuildResult;
  readonly page: SpatialPageDoc;
}

const FACE_ID_BY_DIRECTION: Readonly<Record<CubeFaceDirection, string>> = {
  "x-": "face.x.neg",
  "x+": "face.x.pos",
  "y-": "face.y.neg",
  "y+": "face.y.pos",
  "z-": "face.z.neg",
  "z+": "face.z.pos",
};

const ADJACENCY_DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
] as const;

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactNumber(value: { readonly numerator: number; readonly denominator: number }): number {
  return value.numerator / value.denominator;
}

function dot(
  left: IntegerVector3,
  right: { readonly x: number; readonly y: number; readonly z: number },
): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function planarCoordinate(value: number, subject: string): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-9) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.mappingFailed,
      `cube face vertex does not map to an integer planar corner: ${subject}`,
    );
  }
  return rounded;
}

function placementByFaceId(analysis: CubeNetAnalysis) {
  return new Map(
    analysis.faces.map((placement) => [FACE_ID_BY_DIRECTION[placement.cubeFace], placement]),
  );
}

function buildLayoutFaces(
  base: PolyhedronSceneAdapterInput,
  analysis: CubeNetAnalysis,
): PolyhedronNetLayout["faces"] {
  const placementByFace = placementByFaceId(analysis);
  const positionByVertexId = new Map(base.geometry.vertices.map((vertex) => [
    vertex.vertexId,
    {
      x: exactNumber(vertex.position.x),
      y: exactNumber(vertex.position.y),
      z: exactNumber(vertex.position.z),
    },
  ]));
  return base.topology.faces.map((face) => {
    const placement = placementByFace.get(face.id);
    if (!placement) {
      throw new CubeNetGalleryFoldingError(
        CUBE_NET_GALLERY_FOLDING_ERROR_CODES.mappingFailed,
        `cube net analysis omitted semantic face: ${face.id}`,
      );
    }
    const positions = face.vertexIds.map((vertexId) => positionByVertexId.get(vertexId));
    if (positions.some((position) => !position)) {
      throw new CubeNetGalleryFoldingError(
        CUBE_NET_GALLERY_FOLDING_ERROR_CODES.mappingFailed,
        `cube geometry omitted a face vertex: ${face.id}`,
      );
    }
    const exactPositions = positions as { readonly x: number; readonly y: number; readonly z: number }[];
    const center = exactPositions.reduce(
      (current, position) => ({
        x: current.x + position.x / exactPositions.length,
        y: current.y + position.y / exactPositions.length,
        z: current.z + position.z / exactPositions.length,
      }),
      { x: 0, y: 0, z: 0 },
    );
    return {
      faceId: face.id,
      vertices: face.vertexIds.map((vertexId, index) => {
        const position = exactPositions[index];
        const offset = {
          x: position.x - center.x,
          y: position.y - center.y,
          z: position.z - center.z,
        };
        return {
          vertexId,
          position: {
            x: planarCoordinate(
              placement.cell.x + dot(placement.right, offset) + 0.5,
              `${face.id}:${vertexId}:x`,
            ),
            y: planarCoordinate(
              placement.cell.y + dot(placement.up, offset) + 0.5,
              `${face.id}:${vertexId}:y`,
            ),
          },
        };
      }),
    };
  });
}

function adjacentHingeEdgeIds(
  base: PolyhedronSceneAdapterInput,
  analysis: CubeNetAnalysis,
): readonly string[] {
  const topology = analyzePolyhedronTopology(base.topology);
  const placementByCell = new Map(
    analysis.faces.map((placement) => [squareCellKey(placement.cell), placement]),
  );
  const edgeIds = new Set<string>();
  for (const placement of analysis.faces) {
    for (const direction of ADJACENCY_DIRECTIONS) {
      const neighborCell: SquareCell = {
        x: placement.cell.x + direction.dx,
        y: placement.cell.y + direction.dy,
      };
      const neighbor = placementByCell.get(squareCellKey(neighborCell));
      if (!neighbor) continue;
      const faceIds = [
        FACE_ID_BY_DIRECTION[placement.cubeFace],
        FACE_ID_BY_DIRECTION[neighbor.cubeFace],
      ];
      const edge = topology.edges.find((candidate) =>
        candidate.faceIds.length === 2 &&
        faceIds.every((faceId) => candidate.faceIds.includes(faceId)),
      );
      if (!edge) {
        throw new CubeNetGalleryFoldingError(
          CUBE_NET_GALLERY_FOLDING_ERROR_CODES.mappingFailed,
          `adjacent net cells do not share a semantic cube edge: ${faceIds.join("/")}`,
        );
      }
      edgeIds.add(edge.edgeId);
    }
  }
  const stable = [...edgeIds].sort(compareIds);
  if (stable.length !== 5) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.mappingFailed,
      `legal cube net must compile to five hinges, received ${stable.length}`,
    );
  }
  return stable;
}

function provisionalHingeGraph(
  base: PolyhedronSceneAdapterInput,
  edgeIds: readonly string[],
): PolyhedronHingeGraph {
  return parsePolyhedronHingeGraph({
    hingeVersion: POLYHEDRON_HINGE_GRAPH_VERSION,
    topologyId: base.topology.topologyId,
    rootFaceId: "face.z.pos",
    hinges: edgeIds.map((edgeId) => ({ edgeId, foldSense: "valley" as const })),
  });
}

function finalHingeGraph(
  provisional: PolyhedronHingeGraph,
  simulation: PolyhedronFoldSimulationAnalysis,
): PolyhedronHingeGraph {
  if (simulation.targetAngles.length !== 5) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.simulationFailed,
      "provisional cube-net simulation did not resolve five target angles",
    );
  }
  const expectedByEdgeId = new Map(
    simulation.targetAngles.map((angle) => [angle.edgeId, angle.expectedSignedAngleMicrodegrees]),
  );
  return parsePolyhedronHingeGraph({
    ...provisional,
    hinges: provisional.hinges.map((hinge) => {
      const expected = expectedByEdgeId.get(hinge.edgeId);
      if (expected !== 90_000_000 && expected !== -90_000_000) {
        throw new CubeNetGalleryFoldingError(
          CUBE_NET_GALLERY_FOLDING_ERROR_CODES.simulationFailed,
          `cube hinge target angle is not plus or minus 90 degrees: ${hinge.edgeId}`,
        );
      }
      return {
        edgeId: hinge.edgeId,
        foldSense: expected > 0 ? "valley" as const : "mountain" as const,
      };
    }),
  });
}

function createSceneInput(
  entry: CubeNetGalleryEntry,
  analysis: CubeNetAnalysis,
): PolyhedronSceneAdapterInput {
  const base = createCubeNetFoldingSceneInput(createCubeNetFoldingPresetRequest());
  const edgeIds = adjacentHingeEdgeIds(base, analysis);
  const provisionalGraph = provisionalHingeGraph(base, edgeIds);
  const layout = parsePolyhedronNetLayout({
    layoutVersion: POLYHEDRON_NET_LAYOUT_VERSION,
    topologyId: base.topology.topologyId,
    rootFaceId: "face.z.pos",
    faces: buildLayoutFaces(base, analysis),
    foldTargets: edgeIds.map((edgeId) => ({
      edgeId,
      targetAngleMicrodegrees: 90_000_000,
    })),
  });
  const provisionalSimulation = analyzePolyhedronFoldSimulation(
    base.topology,
    base.geometry,
    provisionalGraph,
    layout,
    base.simulationRequest,
  );
  const hingeGraph = finalHingeGraph(provisionalGraph, provisionalSimulation);
  return parsePolyhedronSceneAdapterInput({
    ...base,
    sceneId: `scene.spatial-lab.cube-net-folding.${entry.id}`,
    title: {
      zh: `正方体展开与折叠 · 第${entry.classificationOrdinal}种`,
      en: `Cube net and folding · Form ${entry.classificationOrdinal}`,
    },
    hingeGraph,
    layout,
  });
}

async function materializePage(sceneBuild: PolyhedronFoldSceneBuildResult): Promise<SpatialPageDoc> {
  const page = await materializeSpatialPageDoc({
    docVersion: SPATIAL_PAGE_DOC_VERSION,
    layout: { profile: "standard-4x3" },
    scene: sceneBuild.scene,
    source: { kind: "scratch" },
    presentation: {
      viewport: {
        width: 1_200,
        height: 900,
        safeFrame: { x: 0.04, y: 0.04, width: 0.92, height: 0.92 },
      },
      camera: {
        defaultCameraId: "camera.front",
        interaction: "orbit",
        transition: "smooth",
        reducedMotion: "jump",
      },
      labelPlacements: [],
      panels: [],
    },
    classroom: {
      ownership: {
        defaultMode: "teacher-follow",
        allowedModes: ["teacher-follow", "student-local-explore", "student-submit"],
      },
      cameraSync: "bookmark-only",
      durableStatePolicy: "semantic-events-only",
      resetAuthority: "teacher-controller",
      boardPointerPolicy: "mutually-exclusive-tools",
    },
    learningCheck: {
      mode: "formative-only",
      items: [
        {
          checkpointId: "checkpoint.opposite-face",
          required: true,
          evaluation: "server-pinned-kernel",
        },
      ],
      maxSubmissions: 2,
      responseVisibility: "student-and-authorized-staff",
    },
    fallback: {
      strategy: "scene-accessibility-v1",
      defaultView: "front",
      checkpoints: [{ checkpointId: "checkpoint.opposite-face", mode: "interactive-2d" }],
      unavailableMessage: {
        zh: "三维不可用时使用二维展开图。",
        en: "Use the planar net when 3D is unavailable.",
      },
    },
  });
  if (
    page.layout.profile !== "standard-4x3" ||
    page.presentation.viewport.width !== 1_200 ||
    page.presentation.viewport.height !== 900
  ) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.pageContract,
      "cube net gallery folding requires one standard-4x3 1200x900 page",
    );
  }
  return page;
}

export function createCubeNetGalleryFoldingRequest(entryId: string): CubeNetGalleryFoldingRequest {
  return parseCubeNetGalleryFoldingRequest({
    foldingVersion: CUBE_NET_GALLERY_FOLDING_VERSION,
    galleryVersion: CUBE_NET_GALLERY_VERSION,
    entryId,
  });
}

export async function buildCubeNetGalleryFolding(input: unknown): Promise<CubeNetGalleryFoldingBuild> {
  const request = parseCubeNetGalleryFoldingRequest(input);
  const entry = createCubeNetGalleryCatalog().entries.find(
    (candidate) => candidate.id === request.entryId,
  );
  if (!entry) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.unknownEntry,
      `unknown cube-net gallery entry: ${request.entryId}`,
    );
  }
  if (entry.classification !== "legal") {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.invalidEntry,
      `gallery entry cannot fold into a cube: ${entry.id}`,
    );
  }
  const analysis = analyzeCubeNet(entry.net);
  if (!analysis.isCubeNet || analysis.faces.length !== 6) {
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.invalidEntry,
      `gallery entry lost its legal cube-net analysis: ${entry.id}`,
    );
  }
  try {
    const sceneInput = createSceneInput(entry, analysis);
    const sceneBuild = await buildPolyhedronFoldScene(sceneInput);
    const page = await materializePage(sceneBuild);
    return { request, entry, analysis, sceneInput, sceneBuild, page };
  } catch (error) {
    if (error instanceof CubeNetGalleryFoldingError) throw error;
    throw new CubeNetGalleryFoldingError(
      CUBE_NET_GALLERY_FOLDING_ERROR_CODES.simulationFailed,
      error instanceof Error ? error.message : "cube-net folding build failed",
    );
  }
}
