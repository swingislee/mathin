import type { CoursewareDoc } from "@/features/courseware-doc/document";
import { isAixuexiPageDoc } from "@/features/courseware-doc/aixuexi-schema";
import { PAGE_DOC_VERSION, type DocNode, type PageDoc } from "@/features/courseware-doc/schema";
import { getGame } from "@/features/games/registry";
import { getTool } from "@/features/tools/registry";
import type { H5PointerBridgeStatus } from "@/features/courseware-doc/h5-pointer-protocol";
import { isMicrocoursePageDoc } from "@/features/courseware-doc/microcourse-schema";
import { isGamePageDoc } from "@/features/courseware-doc/game-page-schema";
import { isSourceRuntimePageDoc } from "@/features/courseware-doc/source-runtime-schema";
import type { CoursewarePage } from "../types";
import type { ClassroomInputCapability } from "./router";
import {
  CLASSROOM_INK_INPUT_PROVIDER_V1,
  CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1,
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

function nodeContainsH5(node: DocNode): boolean {
  return node.adapter === "h5"
    || node.content?.kind === "h5"
    || node.resources.some((resource) => resource.kind === "h5")
    || node.children.some(nodeContainsH5);
}

function nodeRequiresInteractionProtection(node: DocNode, allowH5: boolean): boolean {
  const h5Node = node.adapter === "h5"
    || node.content?.kind === "h5"
    || node.resources.some((resource) => resource.kind === "h5");
  if (!node.supported) return true;
  if (h5Node) {
    return !allowH5
      || node.adapter !== "h5"
      || !node.resources.some((resource) => resource.kind === "h5")
      || node.children.some((child) => nodeRequiresInteractionProtection(child, allowH5));
  }
  return !AUDITED_NATIVE_DOC_ADAPTERS.has(node.adapter)
    || node.children.some((child) => nodeRequiresInteractionProtection(child, allowH5));
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

/** Native page-doc-v1 DOM remains on the original audited adapter contract. */
export function isAuditedNativeCoursewareDoc(
  doc: CoursewareDoc | null | undefined,
): doc is PageDoc {
  return Boolean(
    doc
    && doc.docVersion === PAGE_DOC_VERSION
    && !doc.nodes.some((node) => nodeRequiresInteractionProtection(node, false)),
  );
}

export function countCoursewareH5Frames(doc: CoursewareDoc | null | undefined): number {
  if (!doc) return 0;
  if (isMicrocoursePageDoc(doc)) {
    if (doc.mode === "h5") return 1;
    if (doc.mode === "composition") {
      return countCoursewareH5Frames(doc.source?.doc)
        + countCoursewareH5Frames(doc.overlay);
    }
    return 0;
  }
  if (isAixuexiPageDoc(doc)) {
    return doc.nodes.reduce((total, node) => total + Number(Boolean(node.embeddedH5)), 0);
  }
  if (isSourceRuntimePageDoc(doc)) return 1;
  if (doc.docVersion !== PAGE_DOC_VERSION) return 0;
  const count = (node: DocNode): number => {
    if (node.adapter === "h5") return 1;
    if (node.adapter !== "group" && node.adapter !== "page") return 0;
    return node.children.reduce((total, child) => total + count(child), 0);
  };
  return doc.nodes.reduce((total, node) => total + count(node), 0);
}

function isH5BridgeEligibleCoursewareDoc(doc: CoursewareDoc): doc is PageDoc {
  return doc.docVersion === PAGE_DOC_VERSION
    && doc.nodes.some(nodeContainsH5)
    && !doc.nodes.some((node) => nodeRequiresInteractionProtection(node, true));
}

/** M3a provider resolution: an overlay provider takes ownership before the underlying renderer. */
export function resolveClassroomRendererInputProfile(
  page: CoursewarePage | undefined,
  toolId: string | null | undefined,
  doc?: CoursewareDoc | null,
  h5BridgeStatus: H5PointerBridgeStatus = "disabled",
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
    if (isGamePageDoc(doc)) {
      const provider = getGame(doc.gameId)?.classroomInput;
      return provider
        ? providerProfile(`document:game:${doc.gameId}`, provider)
        : UNSUPPORTED_PROFILE;
    }
    if (isMicrocoursePageDoc(doc)) {
      if (countCoursewareH5Frames(doc) > 0) {
        if (h5BridgeStatus === "pending") return PROVISIONAL_PROFILE;
        return h5BridgeStatus === "ready"
          ? providerProfile("document:microcourse:h5", CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1)
          : UNSUPPORTED_PROFILE;
      }
      if (doc.mode === "sudoku") {
        const provider = getGame("sudoku")?.classroomInput;
        return provider
          ? providerProfile("document:microcourse:sudoku", provider)
          : UNSUPPORTED_PROFILE;
      }
      return providerProfile(
        "document:microcourse:composition",
        CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1,
      );
    }
    if (isAixuexiPageDoc(doc)) {
      if (countCoursewareH5Frames(doc) > 0) {
        if (h5BridgeStatus === "pending") return PROVISIONAL_PROFILE;
        return h5BridgeStatus === "ready"
          ? providerProfile("document:aixuexi:h5", CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1)
          : UNSUPPORTED_PROFILE;
      }
      return providerProfile("document:aixuexi", CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1);
    }
    if (isSourceRuntimePageDoc(doc)) {
      if (h5BridgeStatus === "pending") return PROVISIONAL_PROFILE;
      return h5BridgeStatus === "ready"
        ? providerProfile("document:source-runtime", CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1)
        : UNSUPPORTED_PROFILE;
    }
    if (isH5BridgeEligibleCoursewareDoc(doc)) {
      if (h5BridgeStatus === "pending") return PROVISIONAL_PROFILE;
      return h5BridgeStatus === "ready"
        ? providerProfile("document:h5", CLASSROOM_INK_INPUT_PROVIDER_V1)
        : UNSUPPORTED_PROFILE;
    }
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
