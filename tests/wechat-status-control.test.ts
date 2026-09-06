import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { WechatStatusControl } from "@/features/school/WechatStatusControl";

type SingleChoiceProps = Extract<ComponentProps<typeof ToggleGroup>, { type: "single" }>;
const labels = { name: "加微信", unknown: "待确认", yes: "已加", no: "未加" };
const render = (value: boolean | null, disabled = false) => renderToStaticMarkup(createElement(WechatStatusControl, {
  value, disabled, labels, onChange: vi.fn(),
}));

describe("compact WeChat status control", () => {
  it.each([
    [null, "unknown"],
    [true, "yes"],
    [false, "no"],
  ] as const)("renders %s with a fixed green icon and two explicit choices", (value, state) => {
    const markup = render(value);
    expect(markup).toContain(`data-wechat-status="${state}"`);
    expect(markup.match(/data-wechat-icon=/g)).toHaveLength(1);
    expect(markup).toContain("mr-1 size-5 shrink-0 text-leaf-deep");
    expect(markup.indexOf("data-wechat-icon")).toBeLessThan(markup.indexOf('role="radio"'));
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup.match(/aria-checked="true"/g) ?? []).toHaveLength(value === null ? 0 : 1);
    expect(markup).toContain(`aria-label="加微信 · ${labels[state]}"`);
    expect(markup).not.toContain("data-wechat-rail");
    expect(markup).not.toContain("data-wechat-thumb");
    expect(markup).not.toContain("data-wechat-morph");
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toMatch(/<p(?:\s|>)/);
    expect(markup).not.toContain("<select");
  });

  it("uses equally sized check and cross buttons with keyboard focus and explicit labels", () => {
    const markup = render(null);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>.*?<\/button>/g)!;
    expect(choices[0]).toContain('aria-label="加微信 · 已加"');
    expect(choices[0]).toContain("lucide-check");
    expect(choices[1]).toContain('aria-label="加微信 · 未加"');
    expect(choices[1]).toContain("lucide-x");
    for (const choice of choices) {
      expect(choice).toContain("focus-visible:ring-2");
      expect(choice).toContain("size-8 min-w-8");
      expect(choice).toContain("bg-muted/6");
      expect(choice).toContain('aria-checked="false"');
    }
    expect(choices[0]).toContain("data-[state=on]:bg-leaf");
    expect(choices[1]).toContain("data-[state=on]:bg-rose/85");
  });

  it("keeps tooltip state separate from selection and preserves the same green identity in every state", () => {
    const icons = [null, true, false].map((value) => {
      const markup = render(value);
      const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
      expect(choices[0]).toContain(`aria-checked="${value === true}"`);
      expect(choices[1]).toContain(`aria-checked="${value === false}"`);
      expect(markup.match(/data-state="on"/g) ?? []).toHaveLength(value === null ? 0 : 1);
      expect(markup).not.toContain('data-state="closed"');
      return markup.match(/<svg[^>]*data-wechat-icon[^>]*>.*?<\/svg>/)?.[0];
    });
    expect(icons[0]).toBeDefined();
    for (const icon of icons) expect(icon).toBe(icons[0]);
  });

  it.each([null, true, false])("keeps %s unchanged on mount and supports selection and clearing", (value) => {
    const onChange = vi.fn();
    const view = WechatStatusControl({ value, labels, onChange });
    const group = view.props.children as ReactElement<SingleChoiceProps>;
    expect(group.type).toBe(ToggleGroup);
    expect(group.props.orientation).toBe("horizontal");
    expect(group.props.dir).toBe("ltr");
    expect(group.props.loop).toBe(false);
    expect(group.props.value).toBe(value === null ? "" : value ? "yes" : "no");
    expect(onChange).not.toHaveBeenCalled();
    group.props.onValueChange?.("");
    group.props.onValueChange?.("yes");
    group.props.onValueChange?.("no");
    group.props.onValueChange?.("unexpected");
    expect(onChange.mock.calls).toEqual([[null], [true], [false]]);
  });

  it("disables both choices without changing the displayed saved fact", () => {
    const onChange = vi.fn();
    const markup = render(true, true);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
    expect(choices).toHaveLength(2);
    for (const choice of choices) expect(choice).toContain('disabled=""');
    expect(markup).toContain('data-wechat-status="yes"');
    const group = WechatStatusControl({ value: true, labels, disabled: true, onChange }).props.children as ReactElement<SingleChoiceProps>;
    group.props.onValueChange?.("no");
    group.props.onValueChange?.("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
