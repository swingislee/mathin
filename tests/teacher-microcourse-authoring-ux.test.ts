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
});
