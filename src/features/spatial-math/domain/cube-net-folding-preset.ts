import {
  CUBE_NET_FOLDING_PRESET_ID,
  CUBE_NET_FOLDING_PRESET_VERSION,
  parseCubeNetFoldingPresetRequest,
  type CubeNetFoldingPresetRequest,
} from "./cube-net-folding-preset-schema";
import { analyzeCubeNet, type CubeNetAnalysis } from "./cube-net-kernel";
import { rational } from "./exact";
import { unitSquareNet, type UnitSquareNet } from "./net-schema";
import {
  SPATIAL_PAGE_DOC_VERSION,
  materializeSpatialPageDoc,
  type SpatialPageDoc,
} from "./page-schema";
import {
  POLYHEDRON_FOLD_SIMULATION_VERSION,
} from "./polyhedron-fold-simulation-schema";
import {
  POLYHEDRON_GEOMETRY_VERSION,
  POLYHEDRON_NET_LAYOUT_VERSION,
  parsePolyhedronGeometry,
  parsePolyhedronNetLayout,
  type PolyhedronNetLayout,
} from "./polyhedron-net-geometry-schema";
import {
  buildPolyhedronFoldScene,
  type PolyhedronFoldSceneBuildResult,
} from "./polyhedron-scene-adapter";
import {
  POLYHEDRON_SCENE_ADAPTER_VERSION,
  parsePolyhedronSceneAdapterInput,
  type PolyhedronSceneAdapterInput,
} from "./polyhedron-scene-adapter-schema";
import {
  POLYHEDRON_HINGE_GRAPH_VERSION,
  POLYHEDRON_TOPOLOGY_VERSION,
  parsePolyhedronHingeGraph,
  parsePolyhedronTopology,
} from "./polyhedron-topology-schema";

export const CUBE_NET_FOLDING_PRESET_ERROR_CODES = {
  invalidNet: "CUBE_NET_FOLDING_PRESET_INVALID_NET",
  pageContract: "CUBE_NET_FOLDING_PRESET_PAGE_CONTRACT",
} as const;

export type CubeNetFoldingPresetErrorCode =
  (typeof CUBE_NET_FOLDING_PRESET_ERROR_CODES)[keyof typeof CUBE_NET_FOLDING_PRESET_ERROR_CODES];

export class CubeNetFoldingPresetError extends Error {
  constructor(
    public readonly code: CubeNetFoldingPresetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CubeNetFoldingPresetError";
  }
}

export interface CubeNetFoldingPresetBuild {
  readonly request: CubeNetFoldingPresetRequest;
  readonly net: UnitSquareNet;
  readonly analysis: CubeNetAnalysis;
  readonly sceneInput: PolyhedronSceneAdapterInput;
  readonly sceneBuild: PolyhedronFoldSceneBuildResult;
  readonly page: SpatialPageDoc;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeVertices(left: string, right: string): [string, string] {
  return compareIds(left, right) <= 0 ? [left, right] : [right, left];
}

function cubeEdgeId(left: string, right: string): string {
  const [first, second] = edgeVertices(left, right);
  return `edge.${first}-${second}`;
}

const CUBE_HINGE_EDGE_IDS = [
  cubeEdgeId("v001", "v011"),
  cubeEdgeId("v001", "v101"),
  cubeEdgeId("v011", "v111"),
  cubeEdgeId("v100", "v110"),
  cubeEdgeId("v101", "v111"),
].sort(compareIds);

const CUBE_FOLD_SENSE_BY_EDGE_ID = new Map<string, "mountain" | "valley">([
  [cubeEdgeId("v001", "v011"), "mountain"],
  [cubeEdgeId("v001", "v101"), "valley"],
  [cubeEdgeId("v011", "v111"), "mountain"],
  [cubeEdgeId("v100", "v110"), "valley"],
  [cubeEdgeId("v101", "v111"), "valley"],
]);

function unitCubeTopology() {
  const faces = [
    { id: "face.x.neg", vertexIds: ["v000", "v001", "v011", "v010"] },
    { id: "face.x.pos", vertexIds: ["v100", "v110", "v111", "v101"] },
    { id: "face.y.neg", vertexIds: ["v000", "v100", "v101", "v001"] },
    { id: "face.y.pos", vertexIds: ["v010", "v011", "v111", "v110"] },
    { id: "face.z.neg", vertexIds: ["v000", "v010", "v110", "v100"] },
    { id: "face.z.pos", vertexIds: ["v001", "v101", "v111", "v011"] },
  ];
  const edges = new Map<string, [string, string]>();
  faces.forEach((face) => {
    face.vertexIds.forEach((vertexId, index) => {
      const next = face.vertexIds[(index + 1) % face.vertexIds.length];
      edges.set(cubeEdgeId(vertexId, next), edgeVertices(vertexId, next));
    });
  });
  return parsePolyhedronTopology({
    topologyVersion: POLYHEDRON_TOPOLOGY_VERSION,
    topologyId: "topology.cube",
    vertices: ["v000", "v001", "v010", "v011", "v100", "v101", "v110", "v111"].map((id) => ({ id })),
    edges: [...edges.entries()]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([id, vertexIds]) => ({ id, vertexIds })),
    faces: faces.sort((left, right) => compareIds(left.id, right.id)),
  });
}

function unitCubeGeometry() {
  return parsePolyhedronGeometry({
    geometryVersion: POLYHEDRON_GEOMETRY_VERSION,
    topologyId: "topology.cube",
    vertices: ["v000", "v001", "v010", "v011", "v100", "v101", "v110", "v111"].map((vertexId) => ({
      vertexId,
      position: {
        x: rational(Number(vertexId[1])),
        y: rational(Number(vertexId[2])),
        z: rational(Number(vertexId[3])),
      },
    })),
  });
}

function unitCubeHingeGraph() {
  return parsePolyhedronHingeGraph({
    hingeVersion: POLYHEDRON_HINGE_GRAPH_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    hinges: CUBE_HINGE_EDGE_IDS.map((edgeId) => ({
      edgeId,
      foldSense: CUBE_FOLD_SENSE_BY_EDGE_ID.get(edgeId),
    })),
  });
}

function layoutFace(
  faceId: string,
  entries: readonly (readonly [vertexId: string, x: number, y: number])[],
): PolyhedronNetLayout["faces"][number] {
  return {
    faceId,
    vertices: entries.map(([vertexId, x, y]) => ({
      vertexId,
      position: { x, y },
    })),
  };
}

function unitCubeNetLayout() {
  return parsePolyhedronNetLayout({
    layoutVersion: POLYHEDRON_NET_LAYOUT_VERSION,
    topologyId: "topology.cube",
    rootFaceId: "face.z.pos",
    faces: [
      layoutFace("face.x.neg", [
        ["v000", -1, 0],
        ["v001", 0, 0],
        ["v011", 0, 1],
        ["v010", -1, 1],
      ]),
      layoutFace("face.x.pos", [
        ["v100", 2, 0],
        ["v110", 2, 1],
        ["v111", 1, 1],
        ["v101", 1, 0],
      ]),
      layoutFace("face.y.neg", [
        ["v000", 0, -1],
        ["v100", 1, -1],
        ["v101", 1, 0],
        ["v001", 0, 0],
      ]),
      layoutFace("face.y.pos", [
        ["v010", 0, 2],
        ["v011", 0, 1],
        ["v111", 1, 1],
        ["v110", 1, 2],
      ]),
      layoutFace("face.z.neg", [
        ["v000", 3, 0],
        ["v010", 3, 1],
        ["v110", 2, 1],
        ["v100", 2, 0],
      ]),
      layoutFace("face.z.pos", [
        ["v001", 0, 0],
        ["v101", 1, 0],
        ["v111", 1, 1],
        ["v011", 0, 1],
      ]),
    ],
    foldTargets: CUBE_HINGE_EDGE_IDS.map((edgeId) => ({
      edgeId,
      targetAngleMicrodegrees: 90_000_000,
    })),
  });
}

function netFromUnitSquareLayout(layout: PolyhedronNetLayout): UnitSquareNet {
  const cells = layout.faces.map((face) => {
    if (face.vertices.length !== 4) {
      throw new CubeNetFoldingPresetError(
        CUBE_NET_FOLDING_PRESET_ERROR_CODES.invalidNet,
        `cube net face must have four vertices: ${face.faceId}`,
      );
    }
    const xs = [...new Set(face.vertices.map((vertex) => vertex.position.x))].sort((left, right) => left - right);
    const ys = [...new Set(face.vertices.map((vertex) => vertex.position.y))].sort((left, right) => left - right);
    if (xs.length !== 2 || ys.length !== 2 || xs[1] - xs[0] !== 1 || ys[1] - ys[0] !== 1) {
      throw new CubeNetFoldingPresetError(
        CUBE_NET_FOLDING_PRESET_ERROR_CODES.invalidNet,
        `cube net face must be one axis-aligned unit square: ${face.faceId}`,
      );
    }
    const actualCorners = new Set(
      face.vertices.map((vertex) => `${vertex.position.x},${vertex.position.y}`),
    );
    const expectedCorners = [
      `${xs[0]},${ys[0]}`,
      `${xs[0]},${ys[1]}`,
      `${xs[1]},${ys[0]}`,
      `${xs[1]},${ys[1]}`,
    ];
    if (expectedCorners.some((corner) => !actualCorners.has(corner))) {
      throw new CubeNetFoldingPresetError(
        CUBE_NET_FOLDING_PRESET_ERROR_CODES.invalidNet,
        `cube net face must contain all unit-square corners: ${face.faceId}`,
      );
    }
    return { x: xs[0], y: ys[0] };
  });
  return unitSquareNet(cells);
}

function assertValidCubeNet(net: UnitSquareNet): CubeNetAnalysis {
  const analysis = analyzeCubeNet(net);
  const semanticFaces = new Set(analysis.faces.map((face) => face.cubeFace));
  if (
    !analysis.isCubeNet ||
    analysis.faces.length !== 6 ||
    semanticFaces.size !== 6 ||
    analysis.adjacencyEdgeCount !== 5
  ) {
    throw new CubeNetFoldingPresetError(
      CUBE_NET_FOLDING_PRESET_ERROR_CODES.invalidNet,
      `cube net preset is invalid: ${analysis.reason}`,
    );
  }
  return analysis;
}

function sceneInputForPreset(): PolyhedronSceneAdapterInput {
  return parsePolyhedronSceneAdapterInput({
    adapterVersion: POLYHEDRON_SCENE_ADAPTER_VERSION,
    sceneId: "scene.spatial-lab.cube-net-folding",
    entityId: "polyhedron.cube",
    title: { zh: "正方体展开与折叠", en: "Cube net and folding" },
    entityLabel: { zh: "正方体", en: "Cube" },
    localePolicy: "bilingual",
    learning: {
      learningGoal: {
        zh: "追踪展开图中标为 A～F 的面，通过折叠判断相邻面与相对面",
        en: "Trace faces A through F in a net and identify adjacent and opposite faces by folding",
      },
      termIds: ["nets-of-solids", "solid-figures"],
      prerequisiteTermIds: ["solid-figures"],
      misconceptions: [
        {
          zh: "只按 A～F 各面在展开图中的平面距离判断相对面",
          en: "Use only the planar distance between faces A through F to decide which are opposite",
        },
      ],
      teacherPrompts: [
        {
          zh: "先预测 A 面的相对面，再折到一半追踪 A～F 各面的方向。",
          en: "Predict the face opposite face A, then fold halfway to trace the directions of faces A through F.",
        },
      ],
    },
    appearance: {
      materialToken: "solid.primary",
      background: "paper",
      lighting: "flat",
    },
    space: { unit: "unit", gridStep: rational(1) },
    topology: unitCubeTopology(),
    geometry: unitCubeGeometry(),
    hingeGraph: unitCubeHingeGraph(),
    layout: unitCubeNetLayout(),
    simulationRequest: {
      simulationVersion: POLYHEDRON_FOLD_SIMULATION_VERSION,
      sampleProgressMillionths: [0, 250_000, 500_000, 750_000, 1_000_000],
      closureToleranceMicrounits: 5,
    },
    faceLabels: [
      { faceId: "face.x.neg", label: { zh: "B", en: "B" } },
      { faceId: "face.x.pos", label: { zh: "C", en: "C" } },
      { faceId: "face.y.neg", label: { zh: "D", en: "D" } },
      { faceId: "face.y.pos", label: { zh: "E", en: "E" } },
      { faceId: "face.z.neg", label: { zh: "F", en: "F" } },
      { faceId: "face.z.pos", label: { zh: "A", en: "A" } },
    ],
    teaching: {
      referenceFaceId: "face.z.pos",
      optionFaceIds: ["face.x.neg", "face.x.pos", "face.z.neg"],
      checkpointId: "checkpoint.opposite-face",
      checkpointPrompt: {
        zh: "哪个面与 A 面相对？",
        en: "Which face is opposite face A?",
      },
      revealPolicy: "teacher",
      fallbackSummary: {
        zh: "二维展开图由标为 A～F 的六个正方形组成；沿五条铰链折叠后形成正方体。",
        en: "The planar net has six squares labeled A through F; folding its five hinges forms a cube.",
      },
      orthographicSummaries: {
        front: { zh: "从正面观察折叠完成的 A～F 面。", en: "Observe the folded faces A through F from the front." },
        right: { zh: "从右面观察折叠完成的 A～F 面。", en: "Observe the folded faces A through F from the right." },
        top: { zh: "从上面观察折叠完成的 A～F 面。", en: "Observe the folded faces A through F from the top." },
      },
    },
    provenance: {
      source: { kind: "scratch" },
      createdBy: "spatial-lab.prototype",
      createdAt: "2026-08-12T00:00:00+08:00",
      minRuntimeVersion: "1.0.0",
    },
  });
}

export function createCubeNetFoldingPresetRequest(): CubeNetFoldingPresetRequest {
  return parseCubeNetFoldingPresetRequest({
    presetVersion: CUBE_NET_FOLDING_PRESET_VERSION,
    presetId: CUBE_NET_FOLDING_PRESET_ID,
  });
}

export function createCubeNetFoldingSceneInput(input: unknown): PolyhedronSceneAdapterInput {
  parseCubeNetFoldingPresetRequest(input);
  const sceneInput = sceneInputForPreset();
  assertValidCubeNet(netFromUnitSquareLayout(sceneInput.layout));
  return sceneInput;
}

export async function buildCubeNetFoldingPreset(input: unknown): Promise<CubeNetFoldingPresetBuild> {
  const request = parseCubeNetFoldingPresetRequest(input);
  const sceneInput = sceneInputForPreset();
  const net = netFromUnitSquareLayout(sceneInput.layout);
  const analysis = assertValidCubeNet(net);
  const sceneBuild = await buildPolyhedronFoldScene(sceneInput);
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
      checkpoints: [
        { checkpointId: "checkpoint.opposite-face", mode: "interactive-2d" },
      ],
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
    throw new CubeNetFoldingPresetError(
      CUBE_NET_FOLDING_PRESET_ERROR_CODES.pageContract,
      "cube net folding preset requires a standard-4x3 1200x900 page",
    );
  }
  return { request, net, analysis, sceneInput, sceneBuild, page };
}
