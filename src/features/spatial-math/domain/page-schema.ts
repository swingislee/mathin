import { z } from "zod";
import { canonicalJsonStringify, canonicalSha256 } from "./canonical-json";
import {
  localizedTextSchema,
  spatialSceneSchema,
  type SpatialScene,
} from "./scene-schema";

export const SPATIAL_PAGE_DOC_VERSION = "spatial-page-v1" as const;
export const SPATIAL_PAGE_LAYOUT_PROFILES = ["standard-4x3", "wide-16x9-exception"] as const;
export const SPATIAL_OWNERSHIP_MODES = [
  "teacher-follow",
  "student-local-explore",
  "student-submit",
] as const;

export const SPATIAL_PAGE_LIMITS = {
  maxBytes: 640 * 1_024,
  maxLabelPlacements: 256,
  maxPanels: 4,
  maxLearningChecks: 100,
} as const;

const stableIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "invalid stable id");
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "invalid sha256");
const normalizedCoordinateSchema = z.number().finite().min(0).max(1);

const spatialPageSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scratch") }).strict(),
  z
    .object({
      kind: z.literal("preset-release"),
      presetId: stableIdSchema,
      releaseNo: z.number().int().positive(),
      sourceSceneHash: sha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("activity-release"),
      activityId: stableIdSchema,
      releaseId: stableIdSchema,
      releaseNo: z.number().int().positive(),
      sourceSceneHash: sha256Schema,
    })
    .strict(),
]);

const spatialPageLayoutSchema = z.discriminatedUnion("profile", [
  z.object({ profile: z.literal("standard-4x3") }).strict(),
  z
    .object({
      profile: z.literal("wide-16x9-exception"),
      reason: localizedTextSchema,
    })
    .strict(),
]);

const normalizedRectangleSchema = z
  .object({
    x: normalizedCoordinateSchema,
    y: normalizedCoordinateSchema,
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .superRefine((rectangle, context) => {
    if (rectangle.x + rectangle.width > 1) {
      context.addIssue({ code: "custom", message: "safe frame exceeds viewport width", path: ["width"] });
    }
    if (rectangle.y + rectangle.height > 1) {
      context.addIssue({ code: "custom", message: "safe frame exceeds viewport height", path: ["height"] });
    }
  });

const labelPlacementSchema = z
  .object({
    entityId: stableIdSchema,
    offsetPx: z
      .object({
        x: z.number().finite().min(-1_024).max(1_024),
        y: z.number().finite().min(-1_024).max(1_024),
      })
      .strict(),
    maxWidthPx: z.number().int().min(80).max(800),
    collision: z.enum(["allow", "hide", "nudge"]),
  })
  .strict();

const panelIdSchema = z.enum(["teacher-controls", "step-rail", "checkpoint", "fallback-table"]);
const PANEL_ORDER = ["teacher-controls", "step-rail", "checkpoint", "fallback-table"] as const;

const panelPlacementSchema = z
  .object({
    panelId: panelIdSchema,
    dock: z.enum(["top", "right", "bottom", "left", "floating"]),
    sizePx: z.number().int().min(120).max(720),
    initiallyCollapsed: z.boolean(),
  })
  .strict();

const layoutPresentationSchema = z
  .object({
    viewport: z
      .object({
        width: z.number().int().min(240).max(4_096),
        height: z.number().int().min(240).max(4_096),
        safeFrame: normalizedRectangleSchema,
      })
      .strict(),
    camera: z
      .object({
        defaultCameraId: stableIdSchema,
        interaction: z.enum(["locked", "orbit", "orbit-and-pan"]),
        transition: z.enum(["none", "smooth"]),
        reducedMotion: z.literal("jump"),
      })
      .strict(),
    labelPlacements: z.array(labelPlacementSchema).max(SPATIAL_PAGE_LIMITS.maxLabelPlacements),
    panels: z.array(panelPlacementSchema).max(SPATIAL_PAGE_LIMITS.maxPanels),
  })
  .strict();

const classroomPolicySchema = z
  .object({
    ownership: z
      .object({
        defaultMode: z.enum(SPATIAL_OWNERSHIP_MODES),
        allowedModes: z.array(z.enum(SPATIAL_OWNERSHIP_MODES)).min(1).max(SPATIAL_OWNERSHIP_MODES.length),
      })
      .strict(),
    cameraSync: z.enum(["off", "bookmark-only", "bookmark-and-opt-in-fx"]),
    durableStatePolicy: z.literal("semantic-events-only"),
    resetAuthority: z.literal("teacher-controller"),
    boardPointerPolicy: z.literal("mutually-exclusive-tools"),
  })
  .strict();

const learningCheckItemSchema = z
  .object({
    checkpointId: stableIdSchema,
    required: z.boolean(),
    evaluation: z.enum(["server-pinned-kernel", "collect-evidence"]),
  })
  .strict();

const learningCheckPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("disabled") }).strict(),
  z
    .object({
      mode: z.literal("formative-only"),
      items: z.array(learningCheckItemSchema).min(1).max(SPATIAL_PAGE_LIMITS.maxLearningChecks),
      maxSubmissions: z.number().int().min(1).max(10),
      responseVisibility: z.literal("student-and-authorized-staff"),
    })
    .strict(),
]);

const fallbackCheckpointSchema = z
  .object({
    checkpointId: stableIdSchema,
    mode: z.enum(["interactive-2d", "alternative-prompt"]),
  })
  .strict();

const fallbackPolicySchema = z
  .object({
    strategy: z.literal("scene-accessibility-v1"),
    defaultView: z.enum(["front", "right", "top"]),
    checkpoints: z.array(fallbackCheckpointSchema).max(SPATIAL_PAGE_LIMITS.maxLearningChecks),
    unavailableMessage: localizedTextSchema,
  })
  .strict();

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function addDuplicateOrOrderIssues(
  values: readonly string[],
  path: (string | number)[],
  context: z.RefinementCtx,
  label: string,
  order?: readonly string[],
): void {
  const seen = new Set<string>();
  const orderIndex = order ? new Map(order.map((value, index) => [value, index])) : undefined;
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({ code: "custom", message: `duplicate ${label}: ${value}`, path: [...path, index] });
    }
    seen.add(value);
    if (index === 0) return;
    const previous = values[index - 1];
    const outOfOrder = orderIndex
      ? (orderIndex.get(previous) ?? -1) > (orderIndex.get(value) ?? -1)
      : compareStableStrings(previous, value) > 0;
    if (outOfOrder) {
      context.addIssue({ code: "custom", message: `${label} must use stable order`, path });
    }
  });
}

export const spatialPageDocSchema = z
  .object({
    docVersion: z.literal(SPATIAL_PAGE_DOC_VERSION),
    layout: spatialPageLayoutSchema,
    sceneHash: sha256Schema,
    scene: spatialSceneSchema,
    source: spatialPageSourceSchema,
    presentation: layoutPresentationSchema,
    classroom: classroomPolicySchema,
    learningCheck: learningCheckPolicySchema,
    fallback: fallbackPolicySchema,
  })
  .strict()
  .superRefine((page, context) => {
    const expectedRatio = page.layout.profile === "standard-4x3" ? [4, 3] : [16, 9];
    if (page.presentation.viewport.width * expectedRatio[1] !== page.presentation.viewport.height * expectedRatio[0]) {
      context.addIssue({
        code: "custom",
        message: `viewport must match ${expectedRatio[0]}:${expectedRatio[1]} layout profile`,
        path: ["presentation", "viewport"],
      });
    }

    const cameraIds = new Set(page.scene.presentation.cameraBookmarks.map((camera) => camera.id));
    if (!cameraIds.has(page.presentation.camera.defaultCameraId)) {
      context.addIssue({
        code: "custom",
        message: `unknown page camera: ${page.presentation.camera.defaultCameraId}`,
        path: ["presentation", "camera", "defaultCameraId"],
      });
    }

    const entityById = new Map(page.scene.model.entities.map((entity) => [entity.id, entity]));
    const labelIds = page.presentation.labelPlacements.map((placement) => placement.entityId);
    addDuplicateOrOrderIssues(labelIds, ["presentation", "labelPlacements"], context, "label entity id");
    page.presentation.labelPlacements.forEach((placement, index) => {
      const entity = entityById.get(placement.entityId);
      if (!entity) {
        context.addIssue({
          code: "custom",
          message: `unknown label entity: ${placement.entityId}`,
          path: ["presentation", "labelPlacements", index, "entityId"],
        });
      } else if (entity.type !== "label") {
        context.addIssue({
          code: "custom",
          message: `label placement entity must be label: ${placement.entityId}`,
          path: ["presentation", "labelPlacements", index, "entityId"],
        });
      }
    });

    const panelIds = page.presentation.panels.map((panel) => panel.panelId);
    addDuplicateOrOrderIssues(panelIds, ["presentation", "panels"], context, "panel id", PANEL_ORDER);

    const ownershipModes = page.classroom.ownership.allowedModes;
    addDuplicateOrOrderIssues(
      ownershipModes,
      ["classroom", "ownership", "allowedModes"],
      context,
      "ownership mode",
      SPATIAL_OWNERSHIP_MODES,
    );
    if (!ownershipModes.includes(page.classroom.ownership.defaultMode)) {
      context.addIssue({
        code: "custom",
        message: "default ownership mode must be allowed",
        path: ["classroom", "ownership", "defaultMode"],
      });
    }

    const checkpointById = new Map(page.scene.checkpoints.map((checkpoint, index) => [checkpoint.id, { checkpoint, index }]));
    const learningItems = page.learningCheck.mode === "formative-only" ? page.learningCheck.items : [];
    const learningIds = learningItems.map((item) => item.checkpointId);
    addDuplicateOrOrderIssues(
      learningIds,
      ["learningCheck", "items"],
      context,
      "learning checkpoint id",
      page.scene.checkpoints.map((checkpoint) => checkpoint.id),
    );
    learningItems.forEach((item, index) => {
      const entry = checkpointById.get(item.checkpointId);
      if (!entry) {
        context.addIssue({
          code: "custom",
          message: `unknown learning checkpoint: ${item.checkpointId}`,
          path: ["learningCheck", "items", index, "checkpointId"],
        });
      } else if (entry.checkpoint.type === "explanation" && item.evaluation === "server-pinned-kernel") {
        context.addIssue({
          code: "custom",
          message: "explanation checkpoints cannot be auto-evaluated",
          path: ["learningCheck", "items", index, "evaluation"],
        });
      }
    });

    const canSubmit = ownershipModes.includes("student-submit");
    if (canSubmit !== (page.learningCheck.mode === "formative-only")) {
      context.addIssue({
        code: "custom",
        message: "student-submit ownership and formative learning checks must be enabled together",
        path: ["classroom", "ownership", "allowedModes"],
      });
    }

    const fallbackIds = page.fallback.checkpoints.map((checkpoint) => checkpoint.checkpointId);
    addDuplicateOrOrderIssues(
      fallbackIds,
      ["fallback", "checkpoints"],
      context,
      "fallback checkpoint id",
      learningIds,
    );
    const learningIdSet = new Set(learningIds);
    fallbackIds.forEach((checkpointId, index) => {
      if (!learningIdSet.has(checkpointId)) {
        context.addIssue({
          code: "custom",
          message: `fallback checkpoint is not an enabled learning check: ${checkpointId}`,
          path: ["fallback", "checkpoints", index, "checkpointId"],
        });
      }
    });
    if (fallbackIds.length !== learningIds.length || fallbackIds.some((id) => !learningIdSet.has(id))) {
      context.addIssue({
        code: "custom",
        message: "fallback must declare one mode for every enabled learning check",
        path: ["fallback", "checkpoints"],
      });
    }

    const sceneSource = page.scene.provenance.source;
    const sourceMatches =
      (page.source.kind === "scratch" && sceneSource.kind === "scratch") ||
      (page.source.kind === "preset-release" &&
        sceneSource.kind === "preset" &&
        page.source.presetId === sceneSource.sourceId &&
        page.source.releaseNo === sceneSource.releaseNo) ||
      (page.source.kind === "activity-release" &&
        sceneSource.kind === "activity-release" &&
        page.source.activityId === sceneSource.sourceId &&
        page.source.releaseNo === sceneSource.releaseNo);
    if (!sourceMatches) {
      context.addIssue({
        code: "custom",
        message: "page source must match materialized scene provenance",
        path: ["source"],
      });
    }

    const bytes = new TextEncoder().encode(canonicalJsonStringify(page)).byteLength;
    if (bytes > SPATIAL_PAGE_LIMITS.maxBytes) {
      context.addIssue({
        code: "custom",
        message: `page size ${bytes} exceeds ${SPATIAL_PAGE_LIMITS.maxBytes} bytes`,
        path: [],
      });
    }
  });

export type SpatialPageDoc = z.infer<typeof spatialPageDocSchema>;
export type SpatialPageDocDraft = Omit<SpatialPageDoc, "sceneHash">;

export const SPATIAL_PAGE_ERROR_CODES = {
  sceneHashMismatch: "SPATIAL_PAGE_SCENE_HASH_MISMATCH",
  layoutSetOrder: "SPATIAL_PAGE_LAYOUT_SET_ORDER",
  layoutSetMismatch: "SPATIAL_PAGE_LAYOUT_SET_MISMATCH",
} as const;

export type SpatialPageErrorCode = (typeof SPATIAL_PAGE_ERROR_CODES)[keyof typeof SPATIAL_PAGE_ERROR_CODES];

export class SpatialPageContractError extends Error {
  constructor(public readonly code: SpatialPageErrorCode, message: string) {
    super(message);
    this.name = "SpatialPageContractError";
  }
}

export function parseSpatialPageDoc(input: unknown): SpatialPageDoc {
  return spatialPageDocSchema.parse(input);
}

export async function materializeSpatialPageDoc(input: SpatialPageDocDraft): Promise<SpatialPageDoc> {
  const scene = spatialSceneSchema.parse(input.scene);
  return parseSpatialPageDoc({ ...input, scene, sceneHash: await canonicalSha256(scene) });
}

export async function verifySpatialPageDoc(input: unknown): Promise<SpatialPageDoc> {
  const page = parseSpatialPageDoc(input);
  const actualHash = await canonicalSha256(page.scene);
  if (page.sceneHash !== actualHash) {
    throw new SpatialPageContractError(
      SPATIAL_PAGE_ERROR_CODES.sceneHashMismatch,
      `scene hash mismatch: expected ${page.sceneHash}, received ${actualHash}`,
    );
  }
  return page;
}

function sharedLayoutContent(page: SpatialPageDoc): Omit<SpatialPageDoc, "layout" | "presentation"> {
  return {
    docVersion: page.docVersion,
    sceneHash: page.sceneHash,
    scene: page.scene,
    source: page.source,
    classroom: page.classroom,
    learningCheck: page.learningCheck,
    fallback: page.fallback,
  };
}

export async function verifySpatialPageLayoutSet(
  standardInput: unknown,
  wideInput?: unknown,
): Promise<{ standard: SpatialPageDoc; wide?: SpatialPageDoc }> {
  const standard = await verifySpatialPageDoc(standardInput);
  if (standard.layout.profile !== "standard-4x3") {
    throw new SpatialPageContractError(
      SPATIAL_PAGE_ERROR_CODES.layoutSetOrder,
      "layout set must start with the standard-4x3 page",
    );
  }
  if (wideInput === undefined) return { standard };

  const wide = await verifySpatialPageDoc(wideInput);
  if (wide.layout.profile !== "wide-16x9-exception") {
    throw new SpatialPageContractError(
      SPATIAL_PAGE_ERROR_CODES.layoutSetOrder,
      "the optional second layout must be a wide-16x9-exception page",
    );
  }
  if (canonicalJsonStringify(sharedLayoutContent(standard)) !== canonicalJsonStringify(sharedLayoutContent(wide))) {
    throw new SpatialPageContractError(
      SPATIAL_PAGE_ERROR_CODES.layoutSetMismatch,
      "layout variants may differ only in layout metadata and presentation",
    );
  }
  return { standard, wide };
}

export function spatialPageScene(page: SpatialPageDoc): SpatialScene {
  return page.scene;
}
