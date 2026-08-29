import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COURSEWARE_DEFAULT_PAPER,
  COURSEWARE_LIGHT_SURFACE_STYLE,
  coursewareCanvasStyle,
} from "@/features/courseware-doc/courseware-surface";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("courseware presentation color domain", () => {
  it("keeps authored content on one stable light palette", () => {
    expect(COURSEWARE_LIGHT_SURFACE_STYLE).toMatchObject({
      colorScheme: "light",
      color: "var(--ink)",
      "--paper": "#fffdf8",
      "--ink": "#29251f",
      "--card": "#ffffff",
      "--line": "#e8e1d5",
    });
    expect(coursewareCanvasStyle(null)).toMatchObject({
      backgroundColor: COURSEWARE_DEFAULT_PAPER,
      colorScheme: "light",
    });
    expect(coursewareCanvasStyle("#f1eadc").backgroundColor).toBe("#f1eadc");
  });

  it("applies the shared palette at every renderer that can expose shell colors", () => {
    const composition = read("src", "features", "courseware-doc", "CoursewareCompositionStage.tsx");
    const game = read("src", "features", "games", "courseware", "GamePageStage.tsx");
    const doc = read("src", "features", "courseware-doc", "DocStage.tsx");
    const legacy = read("src", "features", "courseware-doc", "MicrocourseStage.tsx");
    const sourceRuntime = read("src", "features", "courseware-doc", "SourceRuntimeStage.tsx");

    expect(composition).toContain("coursewareCanvasStyle(doc.canvas.backgroundColor)");
    expect(game).toContain("coursewareCanvasStyle(doc.canvas.backgroundColor)");
    expect(game).toContain('backgroundColor: doc.canvas.backgroundColor ?? "var(--paper)"');
    expect(doc).toContain("...COURSEWARE_LIGHT_SURFACE_STYLE");
    expect(legacy).toContain("coursewareCanvasStyle(doc.canvas.backgroundColor)");
    expect(sourceRuntime).toContain('...coursewareCanvasStyle("#fff")');
  });
});
