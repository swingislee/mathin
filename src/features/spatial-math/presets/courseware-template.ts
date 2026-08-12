import {
  VOXEL_SCENE_ADAPTER_VERSION,
  buildVoxelAuthoringPage,
  canonicalSha256,
  createDefaultVoxelAuthoringDraft,
  materializeSpatialPageDoc,
  parseSpatialScene,
  type SpatialPageDoc,
  type VoxelSceneAdapterInput,
} from "@/features/spatial-math/domain";
import {
  SPATIAL_COURSEWARE_TEMPLATE_ID,
  SPATIAL_COURSEWARE_TEMPLATE_IDS,
  type SpatialCoursewareTemplateId,
} from "./courseware-template-contract";

export const SPATIAL_COURSEWARE_TEMPLATES = [
  {
    id: SPATIAL_COURSEWARE_TEMPLATE_ID,
    releaseNo: 1,
    layoutProfile: "standard-4x3",
    title: { zh: "分层数单位正方体", en: "Count unit cubes by layer" },
  },
] as const;

const TEMPLATE_INPUT: VoxelSceneAdapterInput = {
  adapterVersion: VOXEL_SCENE_ADAPTER_VERSION,
  sceneId: "scene.sml0.voxel-layered-counting",
  entityId: "voxel.main",
  title: SPATIAL_COURSEWARE_TEMPLATES[0].title,
  learningGoal: {
    zh: "结合三视图和分层完整计数",
    en: "Count completely using orthographic views and layers",
  },
  teacherPrompt: {
    zh: "先估一估，再找出可能被挡住的单位正方体。",
    en: "Estimate first, then find unit cubes that may be hidden.",
  },
  misconception: {
    zh: "只数正面能看到的单位正方体",
    en: "Count only unit cubes visible from the front",
  },
  cells: [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 1, z: 1 },
    { x: 0, y: 2, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 },
  ],
  layerAxis: "y",
  materialToken: "voxel.base",
  termIds: ["solid-figures", "views-of-objects"],
  prerequisiteTermIds: ["solid-figures"],
  createdBy: "mathin.courseware-template",
  createdAt: "2026-08-13T00:00:00+08:00",
};

function parseTemplateId(value: unknown): SpatialCoursewareTemplateId {
  if (typeof value !== "string" || !SPATIAL_COURSEWARE_TEMPLATE_IDS.includes(value as SpatialCoursewareTemplateId)) {
    throw new RangeError(`unknown spatial courseware template: ${String(value)}`);
  }
  return value as SpatialCoursewareTemplateId;
}

export async function buildSpatialCoursewareTemplatePage(templateIdValue: unknown): Promise<{
  readonly templateId: SpatialCoursewareTemplateId;
  readonly releaseNo: 1;
  readonly title: (typeof SPATIAL_COURSEWARE_TEMPLATES)[number]["title"];
  readonly page: SpatialPageDoc;
  readonly sceneHash: string;
  readonly pageHash: string;
}> {
  const templateId = parseTemplateId(templateIdValue);
  const template = SPATIAL_COURSEWARE_TEMPLATES.find((item) => item.id === templateId)!;
  const scratch = await buildVoxelAuthoringPage(createDefaultVoxelAuthoringDraft(TEMPLATE_INPUT));
  const scene = parseSpatialScene({
    ...scratch.page.scene,
    provenance: {
      ...scratch.page.scene.provenance,
      source: { kind: "preset", sourceId: template.id, releaseNo: template.releaseNo },
    },
  });
  const sceneHash = await canonicalSha256(scene);
  const page = await materializeSpatialPageDoc({
    docVersion: scratch.page.docVersion,
    layout: scratch.page.layout,
    scene,
    source: {
      kind: "preset-release",
      presetId: template.id,
      releaseNo: template.releaseNo,
      sourceSceneHash: sceneHash,
    },
    presentation: scratch.page.presentation,
    classroom: scratch.page.classroom,
    learningCheck: scratch.page.learningCheck,
    fallback: scratch.page.fallback,
  });

  return {
    templateId,
    releaseNo: template.releaseNo,
    title: template.title,
    page,
    sceneHash,
    pageHash: await canonicalSha256(page),
  };
}

