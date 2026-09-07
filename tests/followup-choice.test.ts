import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FollowupChoice } from "@/features/school/dashboard-page/FollowupChoice";

const options = ["甲", "乙", "丙", "丁"].map((label, index) => ({ value: String(index), label }));
const render = (value: string, choices = options) => renderToStaticMarkup(createElement(FollowupChoice, { value, options: choices, label: "选择负责人", onValueChange: () => {} }));
const trigger = (markup: string) => markup.match(/<button\b[^>]*role="combobox"[^>]*>.*?<\/button>/)?.[0];

describe("follow-up choice labels", () => {
  it.each(["", "no-longer-available"])("shows a useful placeholder for an unselected or missing value: %s", (value) => {
    expect(trigger(render(value))).toContain("选择负责人</span>");
  });

  it("shows the selected label without waiting for the dropdown to mount", () => {
    expect(trigger(render("1"))).toContain("乙</span>");
    expect(trigger(render("", [{ value: "", label: "本次未确认" }, ...options]))).toContain("本次未确认</span>");
  });

  it("uses directly selectable buttons for three choices", () => {
    const markup = render("1", options.slice(0, 3));
    expect(markup).not.toContain('role="combobox"');
    expect(markup.match(/aria-pressed=/g)).toHaveLength(3);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>.*?乙<\/span>/);
  });
  it("keeps a requested select stable even with two options and an unknown placeholder", () => {
    const markup = renderToStaticMarkup(createElement(FollowupChoice, {
      value: "", options: options.slice(0, 2), label: "加微信", placeholder: "待确认",
      presentation: "select", onValueChange: () => {},
    }));
    expect(trigger(markup)).toContain("待确认</span>");
    expect(markup).not.toContain("aria-pressed");
  });
  it("shows four buttons when explicitly requested while preserving the default dropdown", () => {
    const markup = renderToStaticMarkup(createElement(FollowupChoice, {
      value: "1", options, label: "联系结果", presentation: "buttons", onValueChange: () => {},
    }));
    expect(markup).not.toContain('role="combobox"');
    expect(markup.match(/aria-pressed=/g)).toHaveLength(4);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(trigger(render("1"))).toBeDefined();
  });
});
