// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import styles from "@/components/ui/table.module.css";

const source = readFileSync("src/components/ui/table.module.css", "utf8").replace(/\.(records|stacked|label|value|flush)\b/g, (_, name: string) => `.${styles[name]}`);
const mounted: HTMLElement[] = [];

function stylesheet(mobile: boolean) {
  const parser = document.createElement("style");
  parser.textContent = source;
  document.head.append(parser);
  const rules = [...parser.sheet!.cssRules].flatMap(rule => rule.type === CSSRule.MEDIA_RULE
    ? mobile ? [...(rule as CSSMediaRule).cssRules] : [] : [rule]);
  parser.remove();
  const style = document.createElement("style");
  style.textContent = rules.map(rule => rule.cssText).join("\n");
  document.head.append(style);
  mounted.push(style);
  return style;
}

function mount() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(h(Table, { mobileLayout: "stacked" },
    h(TableHeader, null, h(TableRow, null,
      h(TableHead, { id: "filter-head" }, h("button", { type: "button" }, "Filter")),
      h(TableHead, { id: "plain-head" }, "Phone"),
      h(TableHead, null, h("input", { type: "checkbox", "aria-label": "Select all" })))),
    h(TableBody, null,
      h(TableRow, { id: "summary" },
        h(TableCell, { mobileSpan: "primary", id: "identity" }, "Student"),
        h(TableCell, { mobileLabel: "Phone", id: "phone" }, h("input", { defaultValue: "Draft", "aria-label": "Phone" })),
        h(TableCell, { mobileSpan: "secondary", id: "status" }, "Pending"),
        h(TableCell, { mobileLabel: "Note", mobileEmpty: true, id: "empty" }, "—"),
        h(TableCell, { mobileHidden: true, id: "hidden" }),
        h(TableCell, { mobileLabel: "Actions", ...{ "data-table-mobile-actions": true }, id: "actions" }, h("div", null, h("button", null, "Save")))),
      h(TableRow, null, h(TableCell, { colSpan: 6, id: "details" },
        h(Table, { mobileLayout: "stacked" }, h(TableBody, null, h(TableRow, null,
          h(TableCell, { mobileSpan: "primary" }, "Nested record"),
          h(TableCell, { mobileLabel: "Note" }, "Nested details")))))))));
  document.body.append(host);
  mounted.push(host);
  return host;
}

afterEach(() => { mounted.splice(0).forEach(element => element.remove()); });

describe("stacked table layout", () => {
  it("leaves desktop table, fields and controls in their original layout", () => {
    stylesheet(false);
    const host = mount();
    expect(getComputedStyle(host.querySelector("table")!).display).toBe("table");
    expect(getComputedStyle(host.querySelector("#summary")!).display).toBe("table-row");
    expect(getComputedStyle(host.querySelector("#status")!).gridColumn).toBe("");
    expect(getComputedStyle(host.querySelector("[data-table-mobile-label]")!).display).toBe("none");
    expect(getComputedStyle(host.querySelector("[data-table-mobile-value]")!).display).toBe("contents");
    expect(getComputedStyle(host.querySelector("#empty")!).display).toBe("table-cell");
  });

  it("puts the summary first and keeps filters, selection and nested records reachable", () => {
    stylesheet(true);
    const host = mount();
    const style = (id: string) => getComputedStyle(host.querySelector(`#${id}`)!);
    expect(style("summary").display).toBe("grid");
    expect(style("summary").height).toBe("auto");
    expect(style("identity").gridColumn).toBe("1");
    expect(style("status").gridColumn).toBe("2");
    expect(style("status").gridRow).toBe("1");
    expect(style("phone").gridColumn).toBe("1 / -1");
    expect(style("phone").display).toBe("grid");
    expect(style("filter-head").display).toBe("flex");
    expect(style("plain-head").display).toBe("none");
    expect(style("empty").display).toBe("none");
    expect(style("hidden").display).toBe("none");
    expect(style("details").gridColumn).toBe("1 / -1");
    expect(getComputedStyle(host.querySelector('#actions [data-table-mobile-value] > div')!).flexWrap).toBe("wrap");
    expect([...host.querySelectorAll("table")].every(table => getComputedStyle(table).minWidth === "0")).toBe(true);
    expect(host.querySelectorAll('input[aria-label="Select all"]')).toHaveLength(1);
  });

  it("reuses one editor and preserves its draft when the layout changes", () => {
    const desktop = stylesheet(false);
    const host = mount();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Phone"]')!;
    input.value = "Unsaved edit";
    input.focus();
    desktop.remove();
    const mobile = stylesheet(true);
    expect(host.querySelectorAll('input[aria-label="Phone"]')).toHaveLength(1);
    expect(host.querySelector('input[aria-label="Phone"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Unsaved edit");
    mobile.remove();
    stylesheet(false);
    expect(input.value).toBe("Unsaved edit");
  });
});
