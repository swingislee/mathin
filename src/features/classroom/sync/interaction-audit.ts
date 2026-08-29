import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import type { CoursewareDoc } from "@/features/courseware-doc/document";
import { isGamePageDoc } from "@/features/courseware-doc/game-page-schema";
import {
  isMicrocoursePageDoc,
  type MicrocoursePageDoc,
} from "@/features/courseware-doc/microcourse-schema";
import { isSpatialPageDoc } from "@/features/courseware-doc/spatial";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import {
  GAME_COURSEWARE_CONTRACTS,
  getGameCoursewareContract,
} from "@/features/games/courseware/registry";
import {
  CLASSROOM_DOC_STEP_SYNC_V1,
  CLASSROOM_GAME_MIRROR_SYNC_V1,
  CLASSROOM_H5_STATE_SYNC_REQUIRED_V1,
  CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1,
  CLASSROOM_UNREGISTERED_INTERACTION_READ_ONLY_V1,
  isClassroomInteractionSyncProvider,
  type ClassroomInteractionSyncProvider,
} from "./interaction-provider";

export type ClassroomInteractionAuditStatus = "synchronized" | "read-only" | "external";

export interface ClassroomInteractionAuditProfile {
  surface: string;
  ownership: "mathin" | "external";
  status: ClassroomInteractionAuditStatus;
  provider: ClassroomInteractionSyncProvider | null;
}

interface ClassroomDocInteractionRegistration {
  ownership: ClassroomInteractionAuditProfile["ownership"];
  defaultProvider: ClassroomInteractionSyncProvider | null;
}

/**
 * Compile-time exhaustiveness gate: adding a CoursewareDoc version requires an
 * explicit classroom synchronization decision before typecheck can pass.
 */
export const COURSEWARE_DOC_INTERACTION_AUDIT = {
  "page-doc-v1": { ownership: "external", defaultProvider: null },
  "aixuexi-page-doc-v1": { ownership: "external", defaultProvider: null },
  "source-runtime-page-v1": { ownership: "external", defaultProvider: null },
  "microcourse-page-v1": { ownership: "mathin", defaultProvider: CLASSROOM_DOC_STEP_SYNC_V1 },
  "game-page-v1": { ownership: "mathin", defaultProvider: CLASSROOM_GAME_MIRROR_SYNC_V1 },
  "spatial-page-v1": { ownership: "mathin", defaultProvider: CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1 },
} as const satisfies Record<CoursewareDoc["docVersion"], ClassroomDocInteractionRegistration>;

/** A new Mathin-authored microcourse mode cannot silently inherit local-only interaction. */
export const MATHIN_MICROCOURSE_SYNC_PROVIDERS = {
  composition: CLASSROOM_DOC_STEP_SYNC_V1,
  sudoku: CLASSROOM_GAME_MIRROR_SYNC_V1,
  h5: CLASSROOM_H5_STATE_SYNC_REQUIRED_V1,
} as const satisfies Record<MicrocoursePageDoc["mode"], ClassroomInteractionSyncProvider>;

function profile(
  surface: string,
  ownership: ClassroomInteractionAuditProfile["ownership"],
  provider: ClassroomInteractionSyncProvider | null,
): ClassroomInteractionAuditProfile {
  return {
    surface,
    ownership,
    status: ownership === "external"
      ? "external"
      : provider?.mode === "read-only"
        ? "read-only"
        : "synchronized",
    provider,
  };
}

export function resolveClassroomInteractionAudit(
  doc: CoursewareDoc,
): ClassroomInteractionAuditProfile {
  if (isGamePageDoc(doc)) {
    const contract = getGameCoursewareContract(doc.gameId, doc.contentVersion);
    return profile(
      `game:${doc.gameId}:${doc.contentVersion}`,
      "mathin",
      contract?.classroomSync ?? CLASSROOM_UNREGISTERED_INTERACTION_READ_ONLY_V1,
    );
  }

  if (isMicrocoursePageDoc(doc)) {
    if (doc.mode === "composition" && doc.source) {
      const nested = resolveClassroomInteractionAudit(doc.source.doc);
      // A Mathin-authored source owns its state contract. Imported source pages
      // continue through their existing pointer/media/doc-step adapters.
      if (nested.ownership === "mathin") {
        return { ...nested, surface: `microcourse:composition/${nested.surface}` };
      }
    }
    const provider = MATHIN_MICROCOURSE_SYNC_PROVIDERS[doc.mode];
    return profile(`microcourse:${doc.mode}`, "mathin", provider);
  }

  if (isSpatialPageDoc(doc)) {
    return profile("spatial-page-v1", "mathin", CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1);
  }

  if (isAixuexiPageDoc(doc)) return profile("aixuexi-page-doc-v1", "external", null);
  if (isSourceRuntimePageDoc(doc)) return profile("source-runtime-page-v1", "external", null);
  return profile("page-doc-v1", "external", null);
}

/** CI audit: authored interactive registries must either synchronize or be explicitly classroom-read-only. */
export function classroomInteractionAuditIssues(): string[] {
  const issues: string[] = [];
  for (const [docVersion, registration] of Object.entries(COURSEWARE_DOC_INTERACTION_AUDIT)) {
    if (registration.ownership === "mathin"
      && !isClassroomInteractionSyncProvider(registration.defaultProvider)) {
      issues.push(`${docVersion}:missing-provider`);
    }
  }
  for (const contract of GAME_COURSEWARE_CONTRACTS) {
    const provider: ClassroomInteractionSyncProvider = contract.classroomSync;
    if (!isClassroomInteractionSyncProvider(provider)) {
      issues.push(`game:${contract.gameId}:${contract.contentVersion}:invalid-provider`);
    } else if (provider.mode === "read-only") {
      issues.push(`game:${contract.gameId}:${contract.contentVersion}:not-synchronized`);
    }
  }
  for (const [mode, provider] of Object.entries(MATHIN_MICROCOURSE_SYNC_PROVIDERS)) {
    if (!isClassroomInteractionSyncProvider(provider)) issues.push(`microcourse:${mode}:invalid-provider`);
  }
  if (MATHIN_MICROCOURSE_SYNC_PROVIDERS.h5.mode !== "read-only"
    || MATHIN_MICROCOURSE_SYNC_PROVIDERS.h5.protocol !== "h5-state-v1") {
    issues.push("microcourse:h5:must-use-versioned-state-sync");
  }
  if (CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1.mode !== "read-only"
    || CLASSROOM_SPATIAL_COMMAND_SYNC_REQUIRED_V1.protocol !== "spatial-command-v1") {
    issues.push("spatial-page-v1:must-use-semantic-command-sync");
  }
  return issues;
}
