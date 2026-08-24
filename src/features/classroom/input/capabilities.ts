import type { CoursewareDoc } from "@/features/courseware-doc/document";
import { PAGE_DOC_VERSION, type DocNode, type PageDoc } from "@/features/courseware-doc/schema";
import type { CoursewarePage } from "../types";
import type { ClassroomInputCapability } from "./router";

export const CLASSROOM_INPUT_CAPABILITY_VERSION = 1;

export const AUDITED_CLASSROOM_NATIVE_GAME_IDS = ["sudoku", "kakuro", "magic-square"] as const;
export const AUDITED_CLASSROOM_TOOL_IDS = ["fraction-line"] as const;

export type AuditedClassroomNativeGameId = (typeof AUDITED_CLASSROOM_NATIVE_GAME_IDS)[number];
export type AuditedClassroomToolId = (typeof AUDITED_CLASSROOM_TOOL_IDS)[number];
export type AuditedClassroomToolRenderer = `tool:${AuditedClassroomToolId}`;

const auditedNativeGameIds = new Set<string>(AUDITED_CLASSROOM_NATIVE_GAME_IDS);
const auditedToolIds = new Set<string>(AUDITED_CLASSROOM_TOOL_IDS);

export function isAuditedClassroomNativeGame(gameId: string): gameId is AuditedClassroomNativeGameId {
  return auditedNativeGameIds.has(gameId);
}

export function isAuditedClassroomTool(toolId: string): toolId is AuditedClassroomToolId {
  return auditedToolIds.has(toolId);
}

export interface ClassroomRendererInputProfile {
  renderer:
    | "board"
    | "image"
    | "video"
    | "document"
    | AuditedClassroomNativeGameId
    | AuditedClassroomToolRenderer
    | "unsupported";
  version: number;
  audited: boolean;
  /** True while a doc is still resolving; do not persist the temporary protection as a user lock choice. */
  provisional: boolean;
  defaultCapability: ClassroomInputCapability;
}

const UNSUPPORTED_PROFILE: ClassroomRendererInputProfile = {
  renderer: "unsupported",
  version: CLASSROOM_INPUT_CAPABILITY_VERSION,
  audited: false,
  provisional: false,
  defaultCapability: "unknown",
};

const PROVISIONAL_PROFILE: ClassroomRendererInputProfile = {
  ...UNSUPPORTED_PROFILE,
  provisional: true,
};

const AUDITED_NATIVE_DOC_ADAPTERS = new Set([
  "group",
  "page",
  "image",
  "svg",
  "math_vertical",
  "shape",
  "video",
  "audio",
  "table",
  "rich_text",
  "text",
]);

function nodeRequiresInteractionProtection(node: DocNode): boolean {
  return !node.supported
    || !AUDITED_NATIVE_DOC_ADAPTERS.has(node.adapter)
    || node.content?.kind === "h5"
    || node.resources.some((resource) => resource.kind === "h5")
    || node.children.some(nodeRequiresInteractionProtection);
}

/** Only native page-doc-v1 DOM is audited here; Aixuexi, spatial, and H5 remain fail-closed. */
export function isAuditedNativeCoursewareDoc(
  doc: CoursewareDoc | null | undefined,
): doc is PageDoc {
  return Boolean(
    doc
    && doc.docVersion === PAGE_DOC_VERSION
    && !doc.nodes.some(nodeRequiresInteractionProtection),
  );
}

/** M3a registry: audited tool overlays take ownership before the underlying courseware renderer. */
export function resolveClassroomRendererInputProfile(
  page: CoursewarePage | undefined,
  toolId: string | null | undefined,
  doc?: CoursewareDoc | null,
): ClassroomRendererInputProfile {
  if (toolId) {
    if (!isAuditedClassroomTool(toolId)) return UNSUPPORTED_PROFILE;
    return {
      renderer: `tool:${toolId}`,
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
      // Every audited tool emits a root capability. Missing markers stay protected.
      defaultCapability: "unknown",
    };
  }
  if (!page) return UNSUPPORTED_PROFILE;
  if (page.type === "board") {
    return {
      renderer: "board",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
      defaultCapability: "ink",
    };
  }
  if (page.type === "image") {
    return {
      renderer: "image",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
      defaultCapability: "ink",
    };
  }
  if (page.type === "video") {
    return {
      renderer: "video",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
      defaultCapability: "ink",
    };
  }
  if (page.type === "doc") {
    if (!doc) return PROVISIONAL_PROFILE;
    if (!isAuditedNativeCoursewareDoc(doc)) return UNSUPPORTED_PROFILE;
    return {
      renderer: "document",
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
      defaultCapability: "ink",
    };
  }
  if (page.type === "game" && isAuditedClassroomNativeGame(page.gameId)) {
    return {
      renderer: page.gameId,
      version: CLASSROOM_INPUT_CAPABILITY_VERSION,
      audited: true,
      provisional: false,
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
