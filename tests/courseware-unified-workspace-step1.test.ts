import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-CW-1 Step 1 read-only unified courseware workspace", () => {
  it("opens the exact previewed page directly from the course product", () => {
    const coursePage = read("src", "app", "[locale]", "dashboard", "courses", "[courseFamilyId]", "page.tsx");
    const panel = read("src", "features", "school", "curriculum", "LecturePreviewPanel.tsx");
    const button = read("src", "features", "school", "curriculum", "OpenCoursewareWorkspaceButton.tsx");

    expect(coursePage).toContain("workspace=courseware&canvas=compare");
    expect(panel).toContain("OpenCoursewareWorkspaceButton");
    expect(button).toContain('new URLSearchParams(window.location.search).get("page")');
    expect(button).toContain('target.searchParams.set("page"');
  });

  it("keeps course actions with the variant filters and falls back to 16:9 when 4:3 is unavailable", () => {
    const coursePage = read("src", "app", "[locale]", "dashboard", "courses", "[courseFamilyId]", "page.tsx");
    const panel = read("src", "features", "school", "curriculum", "LecturePreviewPanel.tsx");

    expect(coursePage).toContain("data-course-variant-command-row");
    expect(coursePage).not.toContain("primaryAction={primaryAction}");
    expect(coursePage).toContain("preview = adaptedPreview ?? nativePreview");
    expect(coursePage).toContain("adaptedPreviewFellBack={adaptedPreviewFellBack}");
    expect(panel).toContain('workspaceT("adaptedFallbackNotice")');
  });

  it("keeps Step 1 read only while exposing directory, comparison canvas, and capability rail", () => {
    const route = read("src", "app", "[locale]", "dashboard", "courseware", "lectures", "[lectureId]", "page.tsx");
    const data = read("src", "features", "courseware-studio", "unified-workspace-data.ts");
    const workspace = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");

    expect(route).toContain('first(rawSearchParams.workspace) === "courseware"');
    expect(data).toContain('requirePerm(locale, "course.view")');
    expect(data).toContain('loadLecturePreview(lectureId, "native-16x9"');
    expect(data).toContain('loadLecturePreview(lectureId, "adapted-4x3"');
    expect(workspace).toContain('data-unified-courseware-workspace');
    expect(workspace).toContain('"compare", "native-16x9", "adapted-4x3"');
    expect(workspace).toContain("ObjectTabs");
    expect(workspace).toContain("StagePreview");
    expect(workspace).toContain('canvas !== "native-16x9" && !adaptedPreview');
    expect(workspace).toContain('visibleCanvas: UnifiedWorkspaceCanvas');
    expect(workspace).not.toContain("saveCoursewarePageAction");
    expect(workspace).not.toContain("publishCoursewareReleaseAction");
    expect(workspace).not.toContain('from "./actions"');
  });

  it("fits every single-track stage within both the available width and height", () => {
    const workspace = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const fittedCanvas = read("src", "features", "courseware-studio", "FittedCoursewareCanvas.tsx");

    expect(workspace).toContain('className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-paper"');
    expect(fittedCanvas).toContain("availableHeight * aspect");
    expect(fittedCanvas).toContain("height: size?.height ?? 0");
    expect(fittedCanvas).toContain("data-fitted-courseware-stage");
  });

  it("keeps the new workspace bilingual", () => {
    const zh = JSON.parse(read("messages", "zh.json"));
    const en = JSON.parse(read("messages", "en.json"));
    expect(Object.keys(zh.coursewareWorkspace).sort()).toEqual(Object.keys(en.coursewareWorkspace).sort());
  });
});
