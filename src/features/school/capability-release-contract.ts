import type { OrganizationFeatureKey } from "./organization-settings-contract";

export interface CapabilityReleaseVersionV2 {
  id: string;
  version: number;
  enabled: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
  isEffective: boolean;
}

export interface CapabilityReleaseV2 {
  flagKey: OrganizationFeatureKey;
  enabled: boolean;
  effectiveVersionId: string | null;
  financeReleaseLocked: boolean;
  versions: CapabilityReleaseVersionV2[];
}
