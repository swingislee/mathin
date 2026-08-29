import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSROOM_TEACHING_SURFACE_THEME,
  resolveClassroomTeachingSurface,
} from "@/features/classroom/live/classroom-teaching-surface";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("classroom teaching surface theme", () => {
  it("defaults the whole authored teaching surface to light and exposes future precedence", () => {
    expect(DEFAULT_CLASSROOM_TEACHING_SURFACE_THEME).toBe("light");
    expect(resolveClassroomTeachingSurface()).toMatchObject({
      theme: "light",
      scope: "default",
      surfaceStyle: { colorScheme: "light", "--ink": "#29251f", "--card": "#ffffff" },
      paletteStyle: { "--ink": "#29251f" },
    });
    expect(resolveClassroomTeachingSurface({ sessionTheme: "dark" })).toMatchObject({
      theme: "dark",
      scope: "session",
      surfaceStyle: { "--ink": "#f2eddf", "--card": "#212637" },
    });
    expect(resolveClassroomTeachingSurface({ sessionTheme: "dark", pageTheme: "light" })).toMatchObject({
      theme: "light",
      scope: "page",
    });
  });

  it("binds the main stage, side board and toolbar previews to one resolved theme", () => {
    const shell = read("src", "features", "classroom", "live", "LiveShell.tsx");
    const toolbar = read("src", "features", "whiteboard", "Toolbar.tsx");

    expect(shell).toContain("const teachingSurface = resolveClassroomTeachingSurface()");
    expect(shell).toContain("...teachingSurface.surfaceStyle");
    expect(shell).toContain("style={teachingSurface.surfaceStyle}");
    expect(shell).toContain("swatchStyle={teachingSurface.paletteStyle}");
    expect(shell).toContain("data-classroom-teaching-surface={teachingSurface.theme}");
    expect(toolbar).toContain("swatchStyle?: CSSProperties");
    expect(toolbar).toContain("...swatchStyle, background: colorVar(token)");
    expect(toolbar).toContain("paletteRef.current ?? document.documentElement");
  });
});
