import { canonicalSha256 } from "./canonical-json";
import {
  POLYHEDRON_FOLD_ARTIFACT_VERSION,
  parsePolyhedronFoldArtifact,
  type PolyhedronFoldArtifact,
} from "./polyhedron-fold-artifact-schema";
import {
  POLYHEDRON_FOLD_PROGRESS_SCALE,
  POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
} from "./polyhedron-fold-simulation-schema";
import {
  analyzePolyhedronFoldSimulation,
  computePolyhedronFoldFrame,
  type PolyhedronFoldFrame,
} from "./polyhedron-fold-simulation-kernel";
import { analyzePolyhedronGeometry } from "./polyhedron-net-geometry-kernel";
import {
  POLYHEDRON_SCENE_ADAPTER_VERSION,
  parsePolyhedronSceneAdapterInput,
  type PolyhedronSceneAdapterInput,
} from "./polyhedron-scene-adapter-schema";
import {
  SPATIAL_SCENE_VERSION,
  parseSpatialScene,
  type SpatialScene,
} from "./scene-schema";

export const POLYHEDRON_SCENE_ADAPTER_ERROR_CODES = {
  faceLabelCoverage: "FACE_LABEL_COVERAGE",
  referenceFaceInvalid: "REFERENCE_FACE_INVALID",
  optionFaceInvalid: "OPTION_FACE_INVALID",
  oppositeFaceAmbiguous: "OPPOSITE_FACE_AMBIGUOUS",
  simulationInvalid: "SIMULATION_INVALID",
  entityNotFoldable: "ENTITY_NOT_FOLDABLE",
} as const;

export type PolyhedronSceneAdapterErrorCode =
  (typeof POLYHEDRON_SCENE_ADAPTER_ERROR_CODES)[keyof typeof POLYHEDRON_SCENE_ADAPTER_ERROR_CODES];

export class PolyhedronSceneAdapterError extends Error {
  readonly code: PolyhedronSceneAdapterErrorCode;

  constructor(code: PolyhedronSceneAdapterErrorCode, message: string) {
    super(message);
    this.name = "PolyhedronSceneAdapterError";
    this.code = code;
  }
}

export interface PolyhedronFoldSceneBuildResult {
  readonly adapterVersion: typeof POLYHEDRON_SCENE_ADAPTER_VERSION;
  readonly scene: SpatialScene;
  readonly sceneHash: string;
  readonly folding: PolyhedronFoldArtifact;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactToNumber(value: { readonly numerator: number; readonly denominator: number }): number {
  return value.numerator / value.denominator;
}

function cameraBookmarks(input: PolyhedronSceneAdapterInput): SpatialScene["presentation"]["cameraBookmarks"] {
  const points = input.geometry.vertices.map((vertex) => ({
    x: exactToNumber(vertex.position.x),
    y: exactToNumber(vertex.position.y),
    z: exactToNumber(vertex.position.z),
  }));
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
  };
  const target = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ);
  const distance = extent * 4 + 2;
  return [
    {
      id: "camera.front",
      label: { zh: "正面", en: "Front" },
      projection: "orthographic",
      position: { x: target.x, y: target.y, z: target.z + distance },
      target,
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
    },
    {
      id: "camera.perspective",
      label: { zh: "立体观察", en: "Spatial view" },
      projection: "perspective",
      position: { x: target.x + distance, y: target.y + distance, z: target.z + distance },
      target,
      up: { x: 0, y: 1, z: 0 },
      fovDegrees: 45,
    },
    {
      id: "camera.right",
      label: { zh: "右面", en: "Right" },
      projection: "orthographic",
      position: { x: target.x + distance, y: target.y, z: target.z },
      target,
      up: { x: 0, y: 1, z: 0 },
      zoom: 1,
    },
    {
      id: "camera.top",
      label: { zh: "上面", en: "Top" },
      projection: "orthographic",
      position: { x: target.x, y: target.y + distance, z: target.z },
      target,
      up: { x: 0, y: 0, z: -1 },
      zoom: 1,
    },
  ];
}

function validateFaceConfiguration(input: PolyhedronSceneAdapterInput): string {
  const topologyFaceIds = input.topology.faces.map((face) => face.id);
  const labelFaceIds = input.faceLabels.map((face) => face.faceId);
  if (!sameIds(topologyFaceIds, labelFaceIds)) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.faceLabelCoverage,
      "face labels must cover topology faces in stable order",
    );
  }
  const faceIdSet = new Set(topologyFaceIds);
  if (!faceIdSet.has(input.teaching.referenceFaceId)) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.referenceFaceInvalid,
      `unknown reference face: ${input.teaching.referenceFaceId}`,
    );
  }
  if (
    input.teaching.optionFaceIds.includes(input.teaching.referenceFaceId) ||
    input.teaching.optionFaceIds.some((faceId) => !faceIdSet.has(faceId))
  ) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.optionFaceInvalid,
      "option faces must be known and exclude the reference face",
    );
  }

  const geometryAnalysis = analyzePolyhedronGeometry(input.topology, input.geometry);
  const reference = geometryAnalysis.faces.find((face) => face.faceId === input.teaching.referenceFaceId);
  if (!reference || reference.confirmedOppositeFaceIds.length !== 1) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.oppositeFaceAmbiguous,
      `reference face must have one confirmed geometric opposite: ${input.teaching.referenceFaceId}`,
    );
  }
  const oppositeFaceId = reference.confirmedOppositeFaceIds[0];
  if (!input.teaching.optionFaceIds.includes(oppositeFaceId)) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.optionFaceInvalid,
      `options must include opposite face: ${oppositeFaceId}`,
    );
  }
  return oppositeFaceId;
}

function buildFoldingArtifact(
  input: PolyhedronSceneAdapterInput,
  simulation: ReturnType<typeof analyzePolyhedronFoldSimulation>,
): PolyhedronFoldArtifact {
  if (!simulation.passesSampledValidation || !simulation.finalClosure) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.simulationInvalid,
      `fold simulation failed: ${simulation.issues.map((issue) => issue.code).join(",")}`,
    );
  }
  return parsePolyhedronFoldArtifact({
    artifactVersion: POLYHEDRON_FOLD_ARTIFACT_VERSION,
    topology: input.topology,
    geometry: input.geometry,
    hingeGraph: input.hingeGraph,
    layout: input.layout,
    validation: {
      kernelVersion: simulation.kernelVersion,
      request: input.simulationRequest,
      passesSampledValidation: true,
      collisionEvidence: simulation.collisionEvidence,
      targetAngles: simulation.targetAngles,
      finalClosure: {
        toleranceMicrounits: simulation.finalClosure.toleranceMicrounits,
        maximumVertexErrorMicrounits: simulation.finalClosure.maximumVertexErrorMicrounits,
        faces: simulation.finalClosure.faces,
      },
    },
    fallback: {
      kind: "polyhedron-net-2d-v1",
      summary: input.teaching.fallbackSummary,
      faceLabels: input.faceLabels,
      foldOrderEdgeIds: simulation.targetAngles.map((angle) => angle.edgeId),
    },
  });
}

export async function buildPolyhedronFoldScene(inputValue: unknown): Promise<PolyhedronFoldSceneBuildResult> {
  const input = parsePolyhedronSceneAdapterInput(inputValue);
  const oppositeFaceId = validateFaceConfiguration(input);
  const simulation = analyzePolyhedronFoldSimulation(
    input.topology,
    input.geometry,
    input.hingeGraph,
    input.layout,
    input.simulationRequest,
  );
  const folding = buildFoldingArtifact(input, simulation);
  const faceLabelById = new Map(input.faceLabels.map((face) => [face.faceId, face.label]));
  const scene = parseSpatialScene({
    schemaVersion: SPATIAL_SCENE_VERSION,
    sceneId: input.sceneId,
    title: input.title,
    localePolicy: input.localePolicy,
    learning: {
      capability: "P4",
      learningGoal: input.learning.learningGoal,
      termIds: input.learning.termIds,
      prerequisiteTermIds: input.learning.prerequisiteTermIds,
      misconceptions: input.learning.misconceptions,
      teacherPrompts: input.learning.teacherPrompts,
    },
    space: {
      coordinateSystem: "right-handed-y-up",
      unit: input.space.unit,
      gridStep: input.space.gridStep,
    },
    model: {
      entities: [
        {
          id: input.entityId,
          type: "polyhedron",
          label: input.entityLabel,
          visible: true,
          materialToken: input.appearance.materialToken,
          vertices: input.geometry.vertices.map((vertex) => ({ id: vertex.vertexId, position: vertex.position })),
          faces: input.topology.faces.map((face) => ({ id: face.id, vertexIds: face.vertexIds })),
          folding,
        },
      ],
      parameters: [],
    },
    presentation: {
      background: input.appearance.background,
      lighting: input.appearance.lighting,
      showEdges: true,
      showAxes: false,
      cameraBookmarks: cameraBookmarks(input),
      defaultCameraId: "camera.front",
      layers: [
        {
          id: "layer.polyhedron",
          label: { zh: "立体图形", en: "Solid" },
          initiallyVisible: true,
          selector: { kind: "entities", entityIds: [input.entityId] },
        },
      ],
    },
    sequence: {
      initialStepId: "step.predict",
      steps: [
        {
          id: "step.predict",
          title: { zh: "先预测", en: "Predict" },
          teacherPrompt: { zh: "先观察展开图，猜一猜哪一个面与指定面相对。", en: "Study the net and predict the opposite face." },
          transition: "none",
          durationMs: 0,
          actions: [
            { kind: "camera.apply", cameraId: "camera.front" },
            { kind: "net.foldTo", entityId: input.entityId, progress: 0 },
          ],
        },
        {
          id: "step.explore",
          title: { zh: "观察展开图", en: "Explore the net" },
          teacherPrompt: { zh: "沿着铰链顺序追踪每个面。", en: "Trace each face along the hinge order." },
          transition: "none",
          durationMs: 0,
          actions: [{ kind: "entity.select", entityIds: [input.entityId] }],
        },
        {
          id: "step.fold",
          title: { zh: "折到一半", en: "Fold halfway" },
          announce: { zh: "展开图正在折成立体图形。", en: "The net is folding into the solid." },
          transition: "ease-in-out",
          durationMs: 800,
          actions: [{ kind: "net.foldTo", entityId: input.entityId, progress: 0.5 }],
        },
        {
          id: "step.verify",
          title: { zh: "验证相对面", en: "Verify opposite faces" },
          announce: { zh: "折叠完成，现在验证答案。", en: "The fold is complete; now verify the answer." },
          transition: "ease-in-out",
          durationMs: 800,
          actions: [
            { kind: "net.foldTo", entityId: input.entityId, progress: 1 },
            { kind: "camera.apply", cameraId: "camera.perspective" },
          ],
        },
      ],
    },
    checkpoints: [
      {
        id: input.teaching.checkpointId,
        type: "choice",
        prompt: input.teaching.checkpointPrompt,
        revealPolicy: input.teaching.revealPolicy,
        multiple: false,
        options: input.teaching.optionFaceIds.map((faceId) => ({ id: faceId, label: faceLabelById.get(faceId)! })),
        correctOptionIds: [oppositeFaceId],
      },
    ],
    formulas: [],
    accessibility: {
      summary: input.teaching.fallbackSummary,
      orthographicViews: [
        { view: "front", summary: input.teaching.orthographicSummaries.front },
        { view: "right", summary: input.teaching.orthographicSummaries.right },
        { view: "top", summary: input.teaching.orthographicSummaries.top },
      ],
      layerTable: { enabled: false },
      measurementTable: false,
      objectDescriptions: [{ entityId: input.entityId, description: input.entityLabel }],
      keyboardOrder: [input.entityId],
      colorLegend: [
        {
          materialToken: input.appearance.materialToken,
          label: input.entityLabel,
          pattern: "solid",
        },
      ],
    },
    provenance: {
      source: input.provenance.source,
      createdBy: input.provenance.createdBy,
      createdAt: input.provenance.createdAt,
      kernelVersion: POLYHEDRON_FOLD_SIMULATION_KERNEL_VERSION,
      minRuntimeVersion: input.provenance.minRuntimeVersion,
    },
  });
  return {
    adapterVersion: POLYHEDRON_SCENE_ADAPTER_VERSION,
    scene,
    sceneHash: await canonicalSha256(scene),
    folding,
  };
}

export function resolvePolyhedronFoldFrameFromScene(
  sceneValue: unknown,
  entityId: string,
  progress: number,
): PolyhedronFoldFrame {
  const scene = parseSpatialScene(sceneValue);
  const entity = scene.model.entities.find((candidate) => candidate.id === entityId);
  if (!entity || entity.type !== "polyhedron" || !entity.folding) {
    throw new PolyhedronSceneAdapterError(
      POLYHEDRON_SCENE_ADAPTER_ERROR_CODES.entityNotFoldable,
      `scene entity is not foldable: ${entityId}`,
    );
  }
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("fold progress must be between zero and one");
  }
  return computePolyhedronFoldFrame(
    entity.folding.topology,
    entity.folding.geometry,
    entity.folding.hingeGraph,
    entity.folding.layout,
    Math.round(progress * POLYHEDRON_FOLD_PROGRESS_SCALE),
  );
}
