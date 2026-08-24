import type { ClassroomInputCapability } from "./router";

export const CLASSROOM_INPUT_PROVIDER_SCHEMA = "mathin-classroom-input";
export const CLASSROOM_INPUT_CAPABILITY_VERSION = 1;

/**
 * A renderer opts in to Smart input by publishing this provider from its own
 * registry entry or adapter. Provider conformance is automatic; it is not a
 * request for a renderer-specific manual acceptance round.
 */
export interface ClassroomInputCapabilityProvider {
  schema: typeof CLASSROOM_INPUT_PROVIDER_SCHEMA;
  version: typeof CLASSROOM_INPUT_CAPABILITY_VERSION;
  defaultCapability: ClassroomInputCapability;
}

export const CLASSROOM_INK_INPUT_PROVIDER_V1 = Object.freeze({
  schema: CLASSROOM_INPUT_PROVIDER_SCHEMA,
  version: CLASSROOM_INPUT_CAPABILITY_VERSION,
  defaultCapability: "ink",
} satisfies ClassroomInputCapabilityProvider);

/** Partitioned renderers must mark every owned region; an unmarked region stays protected. */
export const CLASSROOM_PARTITIONED_INPUT_PROVIDER_V1 = Object.freeze({
  schema: CLASSROOM_INPUT_PROVIDER_SCHEMA,
  version: CLASSROOM_INPUT_CAPABILITY_VERSION,
  defaultCapability: "unknown",
} satisfies ClassroomInputCapabilityProvider);

export interface ClassroomInputProviderAttributeSource {
  getAttribute(name: string): string | null;
}

export function isClassroomInputCapabilityProvider(
  value: unknown,
): value is ClassroomInputCapabilityProvider {
  if (!value || typeof value !== "object") return false;
  const provider = value as Partial<ClassroomInputCapabilityProvider>;
  return provider.schema === CLASSROOM_INPUT_PROVIDER_SCHEMA
    && provider.version === CLASSROOM_INPUT_CAPABILITY_VERSION
    && (
      provider.defaultCapability === "click"
      || provider.defaultCapability === "drag"
      || provider.defaultCapability === "native"
      || provider.defaultCapability === "ink"
      || provider.defaultCapability === "unknown"
    );
}

/** Shared renderer-boundary attributes used by the stage and nested provider roots. */
export function classroomInputProviderAttributes(
  renderer: string,
  provider: ClassroomInputCapabilityProvider | null | undefined,
) {
  return {
    "data-classroom-input-provider": provider?.schema,
    "data-classroom-renderer": renderer,
    "data-classroom-renderer-version": provider?.version,
  } as const;
}

export function matchesClassroomInputProviderBoundary(
  source: ClassroomInputProviderAttributeSource,
  renderer: string,
  provider: ClassroomInputCapabilityProvider | null,
): boolean {
  if (!provider) return false;
  return source.getAttribute("data-classroom-input-provider") === provider.schema
    && source.getAttribute("data-classroom-renderer") === renderer
    && source.getAttribute("data-classroom-renderer-version") === String(provider.version);
}
