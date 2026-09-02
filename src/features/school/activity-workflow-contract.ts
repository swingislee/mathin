export const ASSESSMENT_BANDS = [
  "below_a",
  "a",
  "a_plus",
  "g_plus",
  "s",
  "x_plus",
] as const;

export type AssessmentBand = (typeof ASSESSMENT_BANDS)[number];

export const ACTIVITY_ROUTES = [
  "continue_follow_up",
  "await_product",
  "closed",
] as const;

export type ActivityRouteKind = (typeof ACTIVITY_ROUTES)[number];

export const ACTIVITY_WORKSPACE_NODES = [
  "participation",
  "assessment",
  "routing",
] as const;

export type ActivityWorkspaceNode = (typeof ACTIVITY_WORKSPACE_NODES)[number];
