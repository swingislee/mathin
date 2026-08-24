import type { CoursewareDoc } from "@/features/courseware-doc/document";
import { PAGE_DOC_VERSION, type DocNode, type PageDoc } from "@/features/courseware-doc/schema";
import { getGame } from "@/features/games/registry";
import { getTool } from "@/features/tools/registry";
import type { CoursewarePage } from "../types";
import type { ClassroomInputCapability } from "./router";
import {
  CLASSROOM_INK_INPUT_PROVIDER_V1,
  matchesClassroomInputProviderBoundary,
  type ClassroomInputCapabilityProvider,
  type ClassroomInputProviderAttributeSource,
} from "./provider";

export interface ClassroomRendererInputProfile {
  renderer: string;
  audited: boolean;
  /** True while a doc is still resolving; do not persist the temporary protection as a user lock choice. */
  provisional: boolean;
  provider: ClassroomInputCapabilityProvider | null;
}

const UNSUPPORTED_PROFILE: ClassroomRendererInputProfile = {
  renderer: "unsupported",
  audited: false,
  provisional: false,
  provider: null,
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

function providerProfile(
  renderer: string,
  provider: ClassroomInputCapabilityProvider,
): ClassroomRendererInputProfile {
  return {
    renderer,
    audited: true,
    provisional: false,
    provider,
  };
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

/** M3a provider resolution: an overlay provider takes ownership before the underlying renderer. */
export function resolveClassroomRendererInputProfile(
  page: CoursewarePage | undefined,
  toolId: string | null | undefined,
  doc?: CoursewareDoc | null,
): ClassroomRendererInputProfile {
  if (toolId) {
    const provider = getTool(toolId)?.classroomInput;
    return provider ? providerProfile(`tool:${toolId}`, provider) : UNSUPPORTED_PROFILE;
  }
  if (!page) return UNSUPPORTED_PROFILE;
  if (page.type === "board") {
    return providerProfile("board", CLASSROOM_INK_INPUT_PROVIDER_V1);
  }
  if (page.type === "image") {
    return providerProfile("image", CLASSROOM_INK_INPUT_PROVIDER_V1);
  }
  if (page.type === "video") {
    return providerProfile("video", CLASSROOM_INK_INPUT_PROVIDER_V1);
  }
  if (page.type === "doc") {
    if (!doc) return PROVISIONAL_PROFILE;
    if (!isAuditedNativeCoursewareDoc(doc)) return UNSUPPORTED_PROFILE;
    return providerProfile("document", CLASSROOM_INK_INPUT_PROVIDER_V1);
  }
  if (page.type === "game") {
    const provider = getGame(page.gameId)?.classroomInput;
    return provider ? providerProfile(page.gameId, provider) : UNSUPPORTED_PROFILE;
  }
  return UNSUPPORTED_PROFILE;
}

export function parseClassroomInputCapability(
  value: string | null | undefined,
  profile: ClassroomRendererInputProfile,
): ClassroomInputCapability {
  if (!profile.audited || !profile.provider) return "unknown";
  if (!value) return profile.provider.defaultCapability;
  return value === "click" || value === "drag" || value === "native" || value === "ink"
    ? value
    : "unknown";
}

export interface ClassroomInputCapabilityMatch<T> {
  capability: ClassroomInputCapability;
  owner: T | null;
}

/**
 * Conformance resolver shared by the browser router and pure tests. A target
 * marker is trusted only inside a matching provider boundary; missing or stale
 * schema/version/renderer attributes fail closed.
 */
export function resolveClassroomInputCapabilityFromPath<T extends ClassroomInputProviderAttributeSource>(
  path: readonly T[],
  profile: ClassroomRendererInputProfile,
): ClassroomInputCapabilityMatch<T> {
  let owner: T | null = null;
  let value: string | null = null;
  for (const source of path) {
    if (!owner && source.getAttribute("data-classroom-input") !== null) {
      owner = source;
      value = source.getAttribute("data-classroom-input");
    }
    if (source.getAttribute("data-classroom-input-provider") === null) continue;
    if (!matchesClassroomInputProviderBoundary(source, profile.renderer, profile.provider)) {
      return { capability: "unknown", owner };
    }
    return { capability: parseClassroomInputCapability(value, profile), owner };
  }
  return { capability: "unknown", owner };
}
