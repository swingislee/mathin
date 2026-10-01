// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const globalCss = readFileSync("src/app/globals.css", "utf8");
const recordCss = readFileSync("src/components/ui/table.module.css", "utf8");
const mounted: HTMLElement[] = [];

function mount(mobile: boolean) {
  const parser = document.createElement("style");
  parser.textContent = recordCss;
  document.head.append(parser);
  // jsdom 不评估视口媒体条件；按目标宽度展开同一份生产规则。
  const rules = [...parser.sheet!.cssRules].flatMap(rule => {
    if (rule.type === CSSRule.MEDIA_RULE) return mobile ? [...(rule as CSSMediaRule).cssRules] : [];
    return [rule];
  }) as CSSStyleRule[];
  parser.remove();
  const style = document.createElement("style");
  style.textContent = globalCss.slice(globalCss.indexOf("/* 所有表格共用"), globalCss.indexOf("/* 五张学服表共用"))
    + rules.map(rule => rule.cssText).join("\n");
  document.head.append(style);
  const host = document.createElement("div");
  host.innerHTML = recordTable(0);
  document.body.append(host);
  mounted.push(style, host);
  return { host, rules };
}

function recordTable(depth: number): string {
  return `<div class="records" ${depth === 2 ? "data-followup-workbench" : ""}><table data-slot="table"><tbody>
    <tr data-followup-row-key="open-${depth}" data-followup-active="true" data-followup-expanded="true">
      <td data-slot="table-cell" class="sticky" style="position:sticky;left:0;z-index:10">Name</td>
      <td data-slot="table-cell" class="flush">Roster</td>
    </tr>
    <tr data-followup-inline-details data-followup-active="true"><td data-slot="table-cell" colspan="2"><div data-dashboard-inline-entry ${depth < 2 ? 'data-inline-entry-compact="true"' : ''}>
      <div data-inline-entry-header><button data-inline-entry-close>Close</button></div>
      ${depth < 2 ? recordTable(depth + 1) : "Details"}
    </div></td></tr>
    <tr data-followup-row-key="closed-${depth}" data-followup-active="true" data-followup-expanded="false">
      <td data-slot="table-cell">Closed</td><td data-slot="table-cell">Record</td>
    </tr>
  </tbody></table></div>`;
}

afterEach(() => { mounted.splice(0).forEach(element => element.remove()); });

describe("record outlines across table levels", () => {
  it.each([false, true])("shares corners and one foreground outline across all three levels (mobile=%s)", mobile => {
    const { host, rules } = mount(mobile);
    const generatedRules = rules.filter(rule => /::(?:before|after)$/.test(rule.selectorText) && rule.style.getPropertyValue("content") !== "none");
    const containers = [...host.querySelectorAll<HTMLElement>(".records")];
    expect(containers).toHaveLength(3);
    for (const container of containers) {
      expect(getComputedStyle(container).getPropertyValue("--table-record-radius")).toBe("0.25rem");
      const rows = [...container.querySelectorAll<HTMLElement>(':scope > table > tbody > tr')];
      expect(rows.map(row => getComputedStyle(row).borderRadius)).toEqual([
        "var(--table-record-radius) var(--table-record-radius) 0 0",
        "0 0 var(--table-record-radius) var(--table-record-radius)",
        "var(--table-record-radius)",
      ]);
      for (const row of rows) {
        expect(getComputedStyle(row).isolation).toBe("isolate");
        expect(getComputedStyle(row).outline).toBe("1px solid var(--followup-side)");
        expect(getComputedStyle(row).outlineOffset).toBe("-1px");
        expect([...row.children].every(cell => getComputedStyle(cell).boxShadow === "none")).toBe(true);
        // tr 的生成子盒会引入匿名列，即便绝对定位也会挤窄 colspan 详情。
        expect(generatedRules.filter(rule => row.matches(rule.selectorText.replace(/::(?:before|after)$/, "")))).toHaveLength(0);
      }
    }
    for (const close of host.querySelectorAll<HTMLElement>("[data-inline-entry-close]")) expect(getComputedStyle(close).display).toBe("none");
    for (const entry of host.querySelectorAll<HTMLElement>('[data-inline-entry-compact="true"]')) expect(getComputedStyle(entry).paddingRight).toBe("0px");
  });

  it("keeps the existing outline behavior for tables outside the record layout", () => {
    const { host } = mount(false);
    host.querySelectorAll(".records").forEach(container => container.classList.remove("records"));
    const row = host.querySelector<HTMLElement>("[data-followup-row-key]")!;
    expect(getComputedStyle(row).isolation).not.toBe("isolate");
    expect(getComputedStyle(row.firstElementChild!).boxShadow).toContain("var(--followup-side)");
    expect(getComputedStyle(host.querySelector<HTMLElement>("[data-inline-entry-close]")!).display).not.toBe("none");
  });
});
