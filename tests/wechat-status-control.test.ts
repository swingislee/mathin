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
    [null, "unknown", "translate-x-6"],
    [true, "yes", "translate-x-0"],
    [false, "no", "translate-x-12"],
  ] as const)("renders %s at the matching position with exactly one visible SVG state", (value, state, position) => {
    const markup = render(value);
    expect(markup).toContain(`data-wechat-status="${state}"`);
    expect(markup).toMatch(new RegExp(`data-wechat-thumb="${state}" class="[^"]*${position}`));
    expect(markup).toMatch(new RegExp(`data-wechat-icon="${state}" class="[^"]*opacity-100`));
    expect(markup.match(/opacity-100/g)).toHaveLength(1);
    expect(markup.match(/opacity-0"/g)).toHaveLength(2);
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(2);
    expect(markup.match(/aria-checked="true"/g)?.length ?? 0).toBe(value === null ? 0 : 1);
    expect(markup).toContain(`aria-label="加微信 · ${labels[state]}"`);
    expect(markup).toContain("h-8 w-22");
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toMatch(/<p(?:\s|>)/);
    expect(markup).not.toContain("<select");
  });

  it("retains both hit areas, focus handling, and reduced-motion support", () => {
    const markup = render(null);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
    expect(choices[0]).toContain('aria-label="加微信 · 已加"');
    expect(choices[1]).toContain('aria-label="加微信 · 未加"');
    for (const choice of choices) {
      expect(choice).toContain("focus-visible:ring-2");
      expect(choice).toContain("h-8 w-11");
    }
    expect(markup).toContain("pointer-events-none absolute");
    expect(markup).toContain("transition-[translate,border-color]");
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("transition-opacity duration-200");
  });

  it.each([null, true, false])("only emits explicit yes/no choices from %s, and does not clear saved facts", (value) => {
    const onChange = vi.fn();
    const view = WechatStatusControl({ value, labels, onChange });
    const group = view.props.children as ReactElement<SingleChoiceProps>;
    expect(group.type).toBe(ToggleGroup);
    expect(group.props.orientation).toBe("horizontal");
    expect(group.props.dir).toBe("ltr");
    expect(group.props.loop).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    group.props.onValueChange?.("");
    expect(onChange).not.toHaveBeenCalled();
    group.props.onValueChange?.("yes");
    group.props.onValueChange?.("no");
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("disables both choices without changing the displayed saved fact", () => {
    const onChange = vi.fn();
    const markup = render(true, true);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
    for (const choice of choices) expect(choice).toContain('disabled=""');
    expect(markup).toContain('data-wechat-status="yes"');
    const group = WechatStatusControl({ value: true, labels, disabled: true, onChange }).props.children as ReactElement<SingleChoiceProps>;
    group.props.onValueChange?.("no");
    expect(onChange).not.toHaveBeenCalled();
  });
});
