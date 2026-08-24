import type { CoursewarePage } from "../types";
import type { ClassroomInputCapability } from "./router";

export const CLASSROOM_INPUT_CAPABILITY_VERSION = 1;

export const AUDITED_CLASSROOM_NATIVE_GAME_IDS = ["sudoku", "kakuro", "magic-square"] as const;

export type AuditedClassroomNativeGameId = (typeof AUDITED_CLASSROOM_NATIVE_GAME_IDS)[number];

const auditedNativeGameIds = new Set<string>(AUDITED_CLASSROOM_NATIVE_GAME_IDS);

export function isAuditedClassroomNativeGame(gameId: string): gameId is AuditedClassroomNativeGameId {
  return auditedNativeGameIds.has(gameId);
}

export interface ClassroomRendererInputProfile {
  renderer: "board" | "image" | AuditedClassroomNativeGameId | "unsupported";
  version: number;
  audited: boolean;
  defaultCapability: ClassroomInputCapability;
}

const UNSUPPORTED_PROFILE: ClassroomRendererInputProfile = {
  renderer: "unsupported",
  version: CLASSROOM_INPUT_CAPABILITY_VERSION,
  audited: false,
  defaultCapability: "unknown",
};

/** M3a registry: paper/image and the three in-repo native game renderers are audited. */
export function resolveClassroomRendererInputProfile(
  page: CoursewarePage | undefined,
  hasToolOverlay: boolean,
): ClassroomRendererInputProfile {
  if (hasToolOverlay || !page) return UNSUPPORTED_PROFILE;
  if (page.type === "board") {
    return {
      renderer: "board",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      defaultCapability: "ink",
    };
  }
  if (page.type === "image") {
    return {
      renderer: "image",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      defaultCapability: "ink",
    };
  }
  if (page.type === "game" && isAuditedClassroomNativeGame(page.gameId)) {
    return {
      renderer: page.gameId,
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      defaultCapability: "ink",
    };
  }
  return UNSUPPORTED_PROFILE;
}

export function parseClassroomInputCapability(
  value: string | null | undefined,
  profile: ClassroomRendererInputProfile,
): ClassroomInputCapability {
  if (!profile.audited) return "unknown";
  if (!value) return profile.defaultCapability;
  return value === "click" || value === "drag" || value === "native" || value === "ink"
    ? value
    : "unknown";
}
