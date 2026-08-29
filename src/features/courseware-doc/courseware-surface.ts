import type { CSSProperties } from "react";

type CoursewareSurfaceStyle = CSSProperties & {
  [name: `--${string}`]: string | number | undefined;
};

/**
 * Authored 4:3 content is a presentation surface, not application chrome.
 * Keep its base palette stable when Studio or Classroom switches to dark mode.
 */
export const COURSEWARE_DEFAULT_PAPER = "#fffdf8";

export const COURSEWARE_LIGHT_SURFACE_STYLE = {
  colorScheme: "light",
  color: "var(--ink)",
  "--paper": COURSEWARE_DEFAULT_PAPER,
  "--ink": "#29251f",
  "--muted": "#766f65",
  "--line": "#e8e1d5",
  "--card": "#ffffff",
  "--moon": "#feedb9",
  "--star": "#ffebbd",
  "--crater": "#cbab8f",
  "--rose": "#e55c60",
  "--rose-deep": "#c94a4f",
  "--blue": "#3f6fb6",
  "--leaf": "#bbcf87",
  "--leaf-deep": "#6f8b48",
  "--cheek": "#fbc9c3",
  "--p-accent": "#6f8b48",
  "--p-accent-2": "#3e4a5e",
  "--p-wash": "#f8f1e2",
  "--p-line": "#e2d8c2",
} satisfies CoursewareSurfaceStyle;

export function coursewareCanvasStyle(
  backgroundColor: string | null | undefined,
): CoursewareSurfaceStyle {
  return {
    ...COURSEWARE_LIGHT_SURFACE_STYLE,
    backgroundColor: backgroundColor ?? COURSEWARE_DEFAULT_PAPER,
  };
}
