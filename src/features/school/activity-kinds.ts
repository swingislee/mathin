export const ACTIVITY_KINDS = [
  "trial_class",
  "public_class",
  "assessment_1v1",
  "sanbanfu",
  "lecture",
  "competition",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
