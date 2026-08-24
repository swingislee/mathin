export const ORGANIZATION_RULE_DOMAINS = [
  "calendar",
  "lesson",
  "scheduling",
  "notification",
  "finance",
  "public_publishing",
] as const;

export const ORGANIZATION_FEATURE_KEYS = [
  "finance.enabled",
  "notifications.email",
  "notifications.sms",
  "notifications.wechat",
  "public_content.publish",
  "teaching.preparation_archive_edit",
  "teaching.classroom_board_checkpoint_v2",
] as const;

export type OrganizationRuleDomain = (typeof ORGANIZATION_RULE_DOMAINS)[number];
export type OrganizationFeatureKey = (typeof ORGANIZATION_FEATURE_KEYS)[number];

export interface CampusRoomSettings {
  id: string;
  code: string;
  name: string;
  capacity: number | null;
  isActive: boolean;
}

export interface CampusSettings {
  id: string;
  code: string;
  name: string;
  timezone: string | null;
  status: "active" | "archived";
  isDefault: boolean;
  updatedAt: string;
  rooms: CampusRoomSettings[];
}

export interface HolidaySettings {
  id: string;
  campusId: string | null;
  name: string;
  kind: "closed" | "teaching" | "makeup";
  startsOn: string;
  endsOn: string;
  createdAt: string;
}

export interface OrganizationRuleVersion {
  id: string;
  campusId: string | null;
  domain: OrganizationRuleDomain;
  version: number;
  value: Record<string, unknown>;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface FeatureFlagVersion {
  id: string;
  campusId: string | null;
  flagKey: OrganizationFeatureKey;
  version: number;
  enabled: boolean;
  effectiveFrom: string;
  effectiveUntil: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface OrganizationSettingsSnapshot {
  organization: {
    id: string;
    code: string;
    name: string;
    timezone: string;
    defaultLocale: "zh" | "en";
    updatedAt: string;
  };
  campuses: CampusSettings[];
  holidays: HolidaySettings[];
  rules: OrganizationRuleVersion[];
  featureFlags: FeatureFlagVersion[];
  changeToken: string;
}
