export const DEFAULT_CLASSROOM_BACKDROP_ID = "story-journey-v1" as const;

export interface ClassroomBackdropDefinition {
  id: string;
  dayAsset: string;
  nightAsset: string;
  dayBackground: string;
  nightBackground: string;
  dayWash: string;
  nightWash: string;
  backgroundPosition: string;
}

/**
 * Stable classroom ambience registry. Store these ids in future settings, never
 * raw asset URLs. The first implementation intentionally reuses Story artwork.
 */
export const CLASSROOM_BACKDROP_REGISTRY = {
  [DEFAULT_CLASSROOM_BACKDROP_ID]: {
    id: DEFAULT_CLASSROOM_BACKDROP_ID,
    dayAsset: "/illustrations/story-journey-day.webp",
    nightAsset: "/illustrations/story-journey-night.webp",
    dayBackground: "#f5ead7",
    nightBackground: "#11172a",
    dayWash: "linear-gradient(to bottom, rgb(255 249 237 / 35%), transparent 50%, rgb(207 166 109 / 15%))",
    nightWash: "linear-gradient(to bottom, rgb(7 12 29 / 8%), transparent 50%, rgb(3 7 19 / 18%))",
    backgroundPosition: "center",
  },
} as const satisfies Record<string, ClassroomBackdropDefinition>;

export type ClassroomBackdropId = keyof typeof CLASSROOM_BACKDROP_REGISTRY;
export type ClassroomBackdropScope = "session" | "class" | "course" | "organization" | "system";

export interface ClassroomBackdropSelection {
  sessionBackdropId?: string | null;
  classBackdropId?: string | null;
  courseBackdropId?: string | null;
  organizationBackdropId?: string | null;
  systemBackdropId?: string | null;
}

export interface ResolvedClassroomBackdrop {
  backdrop: ClassroomBackdropDefinition;
  requestedId: string;
  scope: ClassroomBackdropScope;
  fellBack: boolean;
}

const BACKDROP_PRIORITY: ReadonlyArray<{
  scope: ClassroomBackdropScope;
  key: keyof ClassroomBackdropSelection;
}> = [
  { scope: "session", key: "sessionBackdropId" },
  { scope: "class", key: "classBackdropId" },
  { scope: "course", key: "courseBackdropId" },
  { scope: "organization", key: "organizationBackdropId" },
  { scope: "system", key: "systemBackdropId" },
];

/**
 * Future configuration precedence is explicit here so grade/season settings can
 * plug in without changing LiveShell. Unknown ids fail safely to the system default.
 */
export function resolveClassroomBackdrop(
  selection: ClassroomBackdropSelection = {},
): ResolvedClassroomBackdrop {
  const requested = BACKDROP_PRIORITY
    .map(({ scope, key }) => ({ scope, id: selection[key] }))
    .find((entry) => typeof entry.id === "string" && entry.id.length > 0);
  const requestedId = requested?.id ?? DEFAULT_CLASSROOM_BACKDROP_ID;
  const resolved = CLASSROOM_BACKDROP_REGISTRY[requestedId as ClassroomBackdropId];

  if (resolved) {
    return {
      backdrop: resolved,
      requestedId,
      scope: requested?.scope ?? "system",
      fellBack: false,
    };
  }

  return {
    backdrop: CLASSROOM_BACKDROP_REGISTRY[DEFAULT_CLASSROOM_BACKDROP_ID],
    requestedId,
    scope: "system",
    fellBack: true,
  };
}

export function listClassroomBackdrops(): readonly ClassroomBackdropDefinition[] {
  return Object.values(CLASSROOM_BACKDROP_REGISTRY);
}
