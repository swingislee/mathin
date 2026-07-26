export const ADAPT_CLASSES = ["A", "B", "C", "D", "E", "F"] as const;
export type AdaptClass = (typeof ADAPT_CLASSES)[number];

export const ADAPT_REJECTION_CODES = [
  "crop_error",
  "subject_missing",
  "aspect_error",
  "quality_issue",
  "classification_error",
  "other",
] as const;
export type AdaptRejectionCode = (typeof ADAPT_REJECTION_CODES)[number];
