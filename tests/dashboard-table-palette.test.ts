import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared table palette", () => {
  it("uses the existing warm selection tokens in light, dark and system themes", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/--table-hover: var\(--followup-hover\);/g)).toHaveLength(3);
    expect(css.match(/--table-selected: var\(--followup-checked\);/g)).toHaveLength(3);
    expect(css).toContain("box-shadow: inset 3px 0 var(--followup-outline)");
    expect(css).not.toMatch(/--table-(?:hover|selected):[^;]*var\(--blue\)/);
    expect(css).toContain("--followup-checked: color-mix(in srgb, var(--moon) 22%, var(--card))");
    expect(css).toContain("--followup-detail: color-mix(in srgb, var(--moon) 14%, var(--card))");
  });
});
