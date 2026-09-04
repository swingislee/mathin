export const ASSESSMENT_BANDS = [
  "x_plus",
  "g_plus",
  "a",
  "a_plus",
  "s",
  "c",
] as const;

export type AssessmentBand = (typeof ASSESSMENT_BANDS)[number];

// `below_a` appeared in the first assessment schema. Keep it readable so an
// old row can be edited without data loss, but do not offer it for new entry.
export const STORED_ASSESSMENT_BANDS = ["below_a", ...ASSESSMENT_BANDS] as const;

export type StoredAssessmentBand = (typeof STORED_ASSESSMENT_BANDS)[number];

export const ACTIVITY_ROUTES = [
  "enrollment_pending",
  "continue_follow_up",
  "await_product",
  "closed",
] as const;

export type ActivityRouteKind = (typeof ACTIVITY_ROUTES)[number];

export const ACTIVITY_WORKSPACE_NODES = [
  "participation",
  "assessment",
] as const;

export type ActivityWorkspaceNode = (typeof ACTIVITY_WORKSPACE_NODES)[number];
