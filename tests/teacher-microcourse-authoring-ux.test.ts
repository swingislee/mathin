import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) => fs.readFileSync(path.join(root, ...segments), "utf8");

describe("teacher microcourse authoring UX", () => {
  it("makes the full published-source card selectable and distinguishes an empty catalog", () => {
    const picker = read("src", "features", "teacher-microcourses", "MicrocourseSourcePicker.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(picker).toContain("aria-pressed={checked}");
    expect(picker).toContain("onClick={() => toggle(source.revisionId)}");
    expect(picker).toContain("sourceCatalogEmpty");
    expect(picker).toContain("retrySourceSearch");
    expect(zh).toContain('"sourceCatalogEmpty"');
    expect(en).toContain('"sourceCatalogEmpty"');
  });

  it("keeps details compact and autosaves every page mode before navigation", () => {
    const editor = read("src", "features", "teacher-microcourses", "MicrocourseEditor.tsx");
    const zh = read("messages", "zh.json");
    const en = read("messages", "en.json");

    expect(editor).toContain("const [detailsOpen, setDetailsOpen] = useState(false)");
    expect(editor).toContain("aria-expanded={detailsOpen}");
    expect(editor).toContain("useImperativeHandle(ref, () => ({ flush })");
    expect(editor).toContain("await persistCurrentPage()");
    expect(editor).toContain("window.setTimeout(() => void flushRef.current(), 800)");
    expect(editor).toContain("saveTeacherMicrocoursePageAction");
    expect(editor).toContain("updateTeacherH5PageAction");
    expect(editor).toContain("h5Html: htmlSnapshot");
    expect(editor).toContain("htmlEditedRef.current");
    expect(editor).toContain('data-testid="microcourse-autosave-status"');
    expect(zh).toContain('"pageAutosaving"');
    expect(en).toContain('"pageAutosaving"');
  });
});
