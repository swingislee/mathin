export const HEALTH_RULE_KEYS = ["communication", "attendance", "participation", "challenge", "homework", "accuracy", "video", "trend"] as const;
export type HealthRuleKey = typeof HEALTH_RULE_KEYS[number];
export interface HealthRulePolicy { enabled: boolean; minSamples: number; threshold: number }
export interface RenewalHealthPolicy {
  version: 1;
  windowDays: 7 | 14 | 28;
  rules: Record<HealthRuleKey, HealthRulePolicy>;
}
export const HEALTH_RULE_BOUNDS: Record<HealthRuleKey, { min: number; max: number }> = {
  communication: { min: 0, max: 100 }, attendance: { min: 1, max: 100 },
  participation: { min: 0, max: 100 }, challenge: { min: 1, max: 100 },
  homework: { min: 1, max: 100 }, accuracy: { min: 0, max: 100 },
  video: { min: 1, max: 100 }, trend: { min: -100, max: 100 },
};
export const DEFAULT_RENEWAL_HEALTH_POLICY: RenewalHealthPolicy = {
  version: 1,
  windowDays: 28,
  rules: {
    communication: { enabled: true, minSamples: 2, threshold: 2 },
    attendance: { enabled: true, minSamples: 1, threshold: 1 },
    participation: { enabled: true, minSamples: 5, threshold: 50 },
    challenge: { enabled: true, minSamples: 5, threshold: 100 },
    homework: { enabled: true, minSamples: 1, threshold: 1 },
    accuracy: { enabled: true, minSamples: 3, threshold: 60 },
    video: { enabled: true, minSamples: 1, threshold: 1 },
    trend: { enabled: true, minSamples: 3, threshold: 0 },
  },
};

export function isRenewalHealthPolicy(value: unknown): value is RenewalHealthPolicy {
  if (!value || typeof value !== "object") return false;
  const policy = value as RenewalHealthPolicy;
  if (policy.version !== 1 || ![7, 14, 28].includes(policy.windowDays) || !policy.rules || typeof policy.rules !== "object") return false;
  if (Object.keys(policy.rules).length !== HEALTH_RULE_KEYS.length) return false;
  return HEALTH_RULE_KEYS.every(key => {
    const rule = policy.rules[key];
    return rule && typeof rule.enabled === "boolean" && Number.isInteger(rule.minSamples)
      && rule.minSamples >= 1 && rule.minSamples <= 100 && Number.isInteger(rule.threshold)
      && rule.threshold >= HEALTH_RULE_BOUNDS[key].min && rule.threshold <= HEALTH_RULE_BOUNDS[key].max;
  });
}
