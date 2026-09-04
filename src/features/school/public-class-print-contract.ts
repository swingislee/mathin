export const PUBLIC_CLASS_PRINT_KINDS = ["signin", "badge", "desk"] as const;

export type PublicClassPrintKind = (typeof PUBLIC_CLASS_PRINT_KINDS)[number];
