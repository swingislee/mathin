import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("DEV-CW-1 Step 2 no-write interaction prototype", () => {
  it("keeps the approved Step 1 shell and mounts one client-side capability leaf", () => {
    const workspace = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    expect(workspace).toContain("CoursewareCapabilityPrototype");
    expect(workspace).toContain("data-unified-courseware-workspace");
    expect(prototype.startsWith('"use client"')).toBe(true);
    expect(prototype).toContain("data-courseware-step2-prototype");
    expect(prototype).toContain('data-persistence="none"');
  });

  it("keeps insertion in the shared top toolbar and three inspector modes on the right", () => {
    const workspace = read("src", "features", "courseware-studio", "UnifiedCoursewareWorkspace.tsx");
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    expect(prototype).toContain('type PrototypeTab = "adjust" | "layout" | "replace"');
    expect(prototype).toContain("CoursewareEditorToolbar");
    expect(prototype).toContain("CoursewareEditorToolbarButton");
    expect(prototype).toContain("createPortal(insertToolbar, toolbarTarget)");
    expect(prototype).toContain('className="grid h-8 w-full grid-cols-3"');
    expect(prototype).not.toContain('<TabsTrigger value="insert"');
    expect(workspace).toContain("INSERT_TOOLBAR_TARGET_ID");
    expect(workspace).toContain("CAPABILITY_TABS_TARGET_ID");
    expect(prototype).toContain('["A", "B", "C", "D", "E", "F", "custom"]');
    expect(prototype).toContain('["page", "lecture", "variant", "family", "all"]');
    expect(prototype).toContain("prototypeSyncContent");
    expect(prototype).toContain("prototypeReplacementDryRunOnly");
    expect(prototype).toContain("prototypeInsertionSyncGate");
    expect(prototype).toContain("prototypeInsertFormula");
    expect(prototype).toContain("prototypeInsertShape");
  });

  it("fails source-runtime node editing closed and keeps undo local to the browser session", () => {
    const prototype = read("src", "features", "courseware-studio", "CoursewareCapabilityPrototype.tsx");

    expect(prototype).toContain('sourceType === "source-runtime-page-v1"');
    expect(prototype).toContain('sourceRuntime && strategy !== "E" && strategy !== "custom"');
    expect(prototype).toContain("setHistory((current) => current.slice(0, -1))");
    expect(prototype).not.toContain("fetch(");
    expect(prototype).not.toContain("saveCoursewarePageAction");
    expect(prototype).not.toContain("publishCoursewareReleaseAction");
    expect(prototype).not.toContain('from "./actions"');
  });

  it("keeps every Step 2 label bilingual", () => {
    const zh = JSON.parse(read("messages", "zh.json"));
    const en = JSON.parse(read("messages", "en.json"));
    expect(Object.keys(zh.coursewareWorkspace).sort()).toEqual(Object.keys(en.coursewareWorkspace).sort());
  });
});
