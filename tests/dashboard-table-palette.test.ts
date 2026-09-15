// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("shared table palette", () => {
  it("uses the existing warm selection tokens in light, dark and system themes", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/--table-hover: var\(--followup-hover\);/g)).toHaveLength(3);
    expect(css.match(/--table-selected: var\(--followup-checked\);/g)).toHaveLength(3);
    expect(css).not.toContain("box-shadow: inset 3px 0 var(--followup-outline)");
    expect(css).not.toMatch(/--table-(?:hover|selected):[^;]*var\(--blue\)/);
    expect(css).toContain("--followup-checked: color-mix(in srgb, var(--moon) 22%, var(--card))");
    expect(css).toContain("--followup-detail: color-mix(in srgb, var(--moon) 14%, var(--card))");
  });

  it("applies the same distinct checked, active and detail surfaces with or without a workbench wrapper", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const style = document.createElement("style");
    style.textContent = css.slice(css.indexOf("/* 所有表格共用"), css.indexOf("/* 五张学服表共用")).replaceAll(":hover", "[data-test-hover]");
    document.head.append(style);
    const host = document.createElement("div"); document.body.append(host);
    try {
      for (const wrapper of ["", "data-followup-workbench"]) {
        host.innerHTML = `<div ${wrapper}><table data-slot="table"><tbody>
          <tr aria-selected="true"><td>checked</td></tr>
          <tr data-followup-active="true" data-followup-expanded="true"><td>active</td></tr>
          <tr data-followup-inline-details data-followup-active="true"><td colspan="2">detail</td></tr>
          <tr data-followup-active="true" data-followup-expanded="true" data-followup-group><td>group</td></tr>
        </tbody></table></div>`;
        const rows = [...host.querySelectorAll("tr")].map(row => { row.setAttribute("data-test-hover", ""); return getComputedStyle(row); });
        expect(rows[0].backgroundColor).toBe("var(--followup-checked)");
        expect(rows[0].getPropertyValue("--followup-side")).toBe("transparent");
        expect(rows[1].backgroundColor).toBe("var(--followup-edit)");
        expect(rows[1].getPropertyValue("--followup-side")).toBe("var(--followup-outline)");
        expect(rows[1].getPropertyValue("--followup-bottom")).toBe("transparent");
        expect(rows[2].backgroundColor).toBe("var(--followup-detail)");
        expect(rows[2].getPropertyValue("--followup-top")).toBe("transparent");
        expect(rows[2].getPropertyValue("--followup-bottom")).toBe("var(--followup-outline)");
        expect(rows[3].getPropertyValue("--followup-bottom")).toBe("var(--followup-outline)");
      }
    } finally { host.remove(); style.remove(); }
  });
});
