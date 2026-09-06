import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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
  ] as const)("renders %s at the matching position with a small morphing glyph", (value, state, position) => {
    const markup = render(value);
    expect(markup).toContain(`data-wechat-status="${state}"`);
    expect(markup).toMatch(new RegExp(`data-wechat-thumb="${state}" class="[^"]*${position}`));
    expect(markup).toContain(`data-wechat-glyph="${state}"`);
    expect(markup.match(/data-wechat-glyph=/g)).toHaveLength(1);
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/role="radio"/g)).toHaveLength(3);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup).toContain(`aria-label="加微信 · ${labels[state]}"`);
    expect(markup).toContain("h-8 w-18");
    expect(markup).toContain("size-5 items-center justify-center rounded-full");
    expect(markup).toContain(value === null ? "bg-card text-muted" : value ? "bg-leaf/25 text-leaf-deep" : "bg-rose/15 text-rose-deep");
    expect(markup).toContain("data-wechat-rail");
    expect(markup).not.toContain("ring-inset");
    expect(markup).not.toContain('role="switch"');
    expect(markup).not.toMatch(/<p(?:\s|>)/);
    expect(markup).not.toContain("<select");
  });

  it("offers left, center, and right hit areas without enlarging the visible glyph", () => {
    const markup = render(null);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
    expect(choices[0]).toContain('aria-label="加微信 · 已加"');
    expect(choices[1]).toContain('aria-label="加微信 · 待确认"');
    expect(choices[2]).toContain('aria-label="加微信 · 未加"');
    for (const choice of choices) {
      expect(choice).toContain("focus-visible:ring-2");
      expect(choice).toContain("h-8 w-6");
    }
    expect(markup).toContain("pointer-events-none absolute");
    expect(markup).toContain("transition-[translate,background-color,color]");
    expect(markup).toContain("motion-reduce:transition-colors");
    expect(markup).toContain("transition-opacity duration-200");
  });

  it("keeps compatible curve topology, static path fallbacks, and reduced-motion rules", () => {
    for (const value of [null, true, false]) {
      const markup = render(value);
      const paths = markup.match(/<path[^>]*data-wechat-morph[^>]*>/g)!;
      expect(paths).toHaveLength(2);
      for (const path of paths) {
        const d = path.match(/\sd="([^"]+)"/)?.[1];
        expect(d?.match(/C/g)).toHaveLength(8);
        expect(path).toContain('style="d:path(');
      }
      expect(markup.match(/data-state="on"/g)).toHaveLength(1);
      expect(markup).not.toContain('data-state="closed"');
    }
    const css = readFileSync(new URL("../src/features/school/followup-micro-interactions.module.css", import.meta.url), "utf8");
    expect(css).toContain("transition: d 200ms ease");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css.split("@media (prefers-reduced-motion: reduce)")[1]).not.toContain("transition: d ");
  });

  it.each([null, true, false])("returns from %s to the center, including when clicking the selected stop again", (value) => {
    const onChange = vi.fn();
    const view = WechatStatusControl({ value, labels, onChange });
    const group = view.props.children as ReactElement<SingleChoiceProps>;
    expect(group.type).toBe(ToggleGroup);
    expect(group.props.orientation).toBe("horizontal");
    expect(group.props.dir).toBe("ltr");
    expect(group.props.loop).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    group.props.onValueChange?.("unknown");
    group.props.onValueChange?.("");
    group.props.onValueChange?.("yes");
    group.props.onValueChange?.("no");
    group.props.onValueChange?.("unexpected");
    expect(onChange.mock.calls).toEqual([[null], [null], [true], [false]]);
  });

  it("disables all three choices without changing the displayed saved fact", () => {
    const onChange = vi.fn();
    const markup = render(true, true);
    const choices = markup.match(/<button\b[^>]*role="radio"[^>]*>/g)!;
    for (const choice of choices) expect(choice).toContain('disabled=""');
    expect(markup).toContain('data-wechat-status="yes"');
    const group = WechatStatusControl({ value: true, labels, disabled: true, onChange }).props.children as ReactElement<SingleChoiceProps>;
    group.props.onValueChange?.("no");
    group.props.onValueChange?.("unknown");
    group.props.onValueChange?.("");
    expect(onChange).not.toHaveBeenCalled();
  });
});
