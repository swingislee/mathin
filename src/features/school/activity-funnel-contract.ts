export const ASSESSMENT_LEVELS = [
  "needs_support",
  "developing",
  "on_track",
  "advanced",
] as const;

export type AssessmentLevel = (typeof ASSESSMENT_LEVELS)[number];

export const OPPORTUNITY_STAGES = [
  "new",
  "contacting",
  "interested",
  "won",
  "lost",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
