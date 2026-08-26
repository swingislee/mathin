import type { H5PointerCapability } from "./h5-pointer-protocol";

export const H5_INPUT_PROFILE_SCHEMA = "mathin-classroom-h5-input-profile-v1";
export const H5_INPUT_PROVIDER_SCHEMA = "mathin-classroom-input";
export const H5_INPUT_PROVIDER_VERSION = 1;

export interface H5InputProfile {
  schemaVersion: typeof H5_INPUT_PROFILE_SCHEMA;
  providerSchema: typeof H5_INPUT_PROVIDER_SCHEMA;
  providerVersion: typeof H5_INPUT_PROVIDER_VERSION;
  defaultCapability: H5PointerCapability;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isH5PointerCapability(value: unknown): value is H5PointerCapability {
  return value === "click"
    || value === "drag"
    || value === "native"
    || value === "ink"
    || value === "unknown";
}

/** Parse only the app-owned registry row; raw package HTML is never an authority. */
export function parseH5InputProfile(value: unknown): H5InputProfile | null {
  if (!isRecord(value)) return null;
  const schemaVersion = value.profile_schema ?? value.schemaVersion;
  const providerSchema = value.provider_schema ?? value.providerSchema;
  const providerVersion = value.provider_version ?? value.providerVersion;
  const defaultCapability = value.default_capability ?? value.defaultCapability;
  if (schemaVersion !== H5_INPUT_PROFILE_SCHEMA
      || providerSchema !== H5_INPUT_PROVIDER_SCHEMA
      || providerVersion !== H5_INPUT_PROVIDER_VERSION
      || !isH5PointerCapability(defaultCapability)) return null;
  return {
    schemaVersion,
    providerSchema,
    providerVersion,
    defaultCapability,
  };
}
