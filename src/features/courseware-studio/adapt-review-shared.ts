export const ADAPT_CLASSES = ["A", "B", "C", "D", "E", "F"] as const;
export type AdaptClass = (typeof ADAPT_CLASSES)[number];
