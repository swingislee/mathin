import type { CSSProperties } from "react";

export type CoursewareSurfaceStyle = CSSProperties & {
  [name: `--${string}`]: string | number | undefined;
};

export type CoursewareSurfaceTheme = "light" | "dark";

/**
 * Authored 4:3 content is a presentation surface, not application chrome.
 * Keep its base palette stable when Studio or Classroom switches to dark mode.
 */
export const COURSEWARE_DEFAULT_PAPER = "#fffdf8";
export const COURSEWARE_DEFAULT_DARK_PAPER = "#191d2b";

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

export const COURSEWARE_DARK_SURFACE_STYLE = {
  colorScheme: "dark",
  color: "var(--ink)",
  "--paper": COURSEWARE_DEFAULT_DARK_PAPER,
  "--ink": "#f2eddf",
  "--muted": "#9ba0b0",
  "--line": "#333a4e",
  "--card": "#212637",
  "--moon": "#d9be7e",
  "--star": "#e8d9a8",
  "--crater": "#8f7a64",
  "--rose": "#e06a6e",
  "--rose-deep": "#c94a4f",
  "--blue": "#7fa9e6",
  "--leaf": "#8fa968",
  "--leaf-deep": "#a9c284",
  "--cheek": "#b98883",
  "--p-accent": "#a9c284",
  "--p-accent-2": "#a7b4c9",
  "--p-wash": "#20242f",
  "--p-line": "#363c4a",
} satisfies CoursewareSurfaceStyle;

export function coursewareSurfaceStyle(theme: CoursewareSurfaceTheme): CoursewareSurfaceStyle {
  return {
    ...(theme === "dark" ? COURSEWARE_DARK_SURFACE_STYLE : COURSEWARE_LIGHT_SURFACE_STYLE),
  };
}

export function coursewarePaletteStyle(theme: CoursewareSurfaceTheme): CoursewareSurfaceStyle {
  const surface = coursewareSurfaceStyle(theme);
  return Object.fromEntries(
    Object.entries(surface).filter(([name]) => name.startsWith("--")),
  ) as CoursewareSurfaceStyle;
}

export function coursewareCanvasStyle(
  backgroundColor: string | null | undefined,
  theme: CoursewareSurfaceTheme = "light",
): CoursewareSurfaceStyle {
  return {
    ...coursewareSurfaceStyle(theme),
    backgroundColor: backgroundColor ?? (theme === "dark" ? COURSEWARE_DEFAULT_DARK_PAPER : COURSEWARE_DEFAULT_PAPER),
  };
}
