import type { CoursewarePage } from "../types";
import type { ClassroomInputCapability } from "./router";

export const CLASSROOM_INPUT_CAPABILITY_VERSION = 1;

export interface ClassroomRendererInputProfile {
  renderer: "board" | "image" | "sudoku" | "unsupported";
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

/** M3a registry: only non-interactive paper/image and the native Sudoku renderer are audited. */
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
  if (page.type === "game" && page.gameId === "sudoku") {
    return {
      renderer: "sudoku",
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
