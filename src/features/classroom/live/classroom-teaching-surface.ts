import {
  coursewarePaletteStyle,
  coursewareSurfaceStyle,
  type CoursewareSurfaceStyle,
  type CoursewareSurfaceTheme,
} from "@/features/courseware-doc/courseware-surface";

export const DEFAULT_CLASSROOM_TEACHING_SURFACE_THEME: CoursewareSurfaceTheme = "light";

export interface ClassroomTeachingSurfaceSelection {
  /** Future authored page contract. A page theme overrides the enclosing session theme. */
  pageTheme?: CoursewareSurfaceTheme | null;
  /** Future lesson/session default used when an authored page has no explicit theme. */
  sessionTheme?: CoursewareSurfaceTheme | null;
}

export interface ResolvedClassroomTeachingSurface {
  theme: CoursewareSurfaceTheme;
  scope: "page" | "session" | "default";
  surfaceStyle: CoursewareSurfaceStyle;
  paletteStyle: CoursewareSurfaceStyle;
}

/**
 * One authored teaching-surface theme owns the main stage, side board and ink
 * palette. App chrome may remain dark without creating white-on-light ink.
 */
export function resolveClassroomTeachingSurface(
  selection: ClassroomTeachingSurfaceSelection = {},
): ResolvedClassroomTeachingSurface {
  const theme = selection.pageTheme ?? selection.sessionTheme ?? DEFAULT_CLASSROOM_TEACHING_SURFACE_THEME;
  const scope = selection.pageTheme
    ? "page"
    : selection.sessionTheme
      ? "session"
      : "default";

  return {
    theme,
    scope,
    surfaceStyle: coursewareSurfaceStyle(theme),
    paletteStyle: coursewarePaletteStyle(theme),
  };
}
