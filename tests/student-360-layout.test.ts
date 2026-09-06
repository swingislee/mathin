import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import zh from "../messages/zh.json";
import { Student360SplitLayout } from "@/features/school/Student360SplitLayout";
import {
  defaultStudent360Width,
  parseStudent360Width,
  STUDENT_360_MAIN_MIN_WIDTH,
  STUDENT_360_SIDE_MIN_WIDTH,
  STUDENT_360_SPLIT_MIN_WIDTH,
} from "@/features/school/student-360-layout-contract";

const viewport = vi.hoisted(() => ({ orientation: "horizontal" as "horizontal" | "vertical" }));
vi.mock("@/hooks/use-split-orientation", () => ({
  useSplitOrientation: () => [{ current: null }, viewport.orientation],
}));

function renderLayout(expanded: boolean, locale: "zh" | "en" = "zh") {
  const props: ComponentProps<typeof Student360SplitLayout> = {
    active: true,
    expanded,
    close: vi.fn(),
    children: createElement("input", { "aria-label": "主表草稿", defaultValue: "保留主表录入" }),
    sidePage: createElement("div", null,
      createElement("h2", { id: "student-360-heading" }, "学生详情"),
      createElement("input", { "aria-label": "侧页草稿", defaultValue: "保留详情录入" }),
    ),
  };
  const providerProps: ComponentProps<typeof NextIntlClientProvider> = {
    locale,
    timeZone: "Asia/Shanghai",
    messages: locale === "zh" ? zh : en,
    children: createElement(Student360SplitLayout, props),
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps));
}

describe("student side-page width", () => {
  it.each([[960, 416], [1040, 416], [1280, 512], [1600, 640], [2560, 736]])(
    "keeps the original default width for a %ipx workspace",
    (workspaceWidth, expected) => expect(defaultStudent360Width(workspaceWidth)).toBe(expected),
  );

  it("leaves both panes useful at the smallest split width", () => {
    expect(defaultStudent360Width(STUDENT_360_SPLIT_MIN_WIDTH)).toBeGreaterThanOrEqual(STUDENT_360_SIDE_MIN_WIDTH);
    expect(STUDENT_360_SPLIT_MIN_WIDTH - defaultStudent360Width(STUDENT_360_SPLIT_MIN_WIDTH) - 1).toBeGreaterThanOrEqual(STUDENT_360_MAIN_MIN_WIDTH);
  });

  it("restores valid user widths beyond the default cap while ignoring invalid storage", () => {
    for (const width of ["320", "512", "940", "1200.5"]) expect(parseStudent360Width(width)).toBe(Number(width));
    for (const width of [null, "", " ", "invalid", "NaN", "Infinity", "-400", "0", "319", "{}"])
      expect(parseStudent360Width(width)).toBeNull();
  });
});

describe("student side-page layout server rendering", () => {
  beforeEach(() => { viewport.orientation = "horizontal"; });

  it.each(["zh", "en"] as const)("renders the real shadcn separator with %s keyboard and pointer guidance", (locale) => {
    const markup = renderLayout(true, locale);
    const labels = (locale === "zh" ? zh : en).school.student360;
    const separator = markup.match(/<div\b[^>]*id="student-360-resize"[^>]*>/)?.[0];
    expect(separator).toBeDefined();
    expect(separator).toContain('role="separator"');
    expect(separator).toContain('tabindex="0"');
    expect(separator).toContain(`aria-label="${labels.resizeSidePage}"`);
    expect(separator).toContain(`title="${labels.resizeSidePageHint}"`);
    expect(separator).not.toContain('aria-disabled="true"');
    expect(markup).toContain('data-student-360-layout="split"');
    expect(markup).not.toContain('role="dialog"');
  });

  it.each([true, false])("renders a single main and side-page input when expanded is %s", (expanded) => {
    const markup = renderLayout(expanded);
    expect(markup.match(/aria-label="主表草稿"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="侧页草稿"/g)).toHaveLength(1);
    const aside = markup.match(/<aside\b[^>]*>/)?.[0];
    expect(aside).toContain(`aria-hidden="${!expanded}"`);
    if (expanded) expect(aside).not.toContain("inert=");
    else {
      expect(aside).toContain('inert=""');
      expect(markup.match(/<div\b[^>]*id="student-360-resize"[^>]*>/)?.[0]).toContain('aria-disabled="true"');
    }
  });

  it("keeps the small-screen overlay outside the collapsed sizing panel", () => {
    viewport.orientation = "vertical";
    const markup = renderLayout(true);
    expect(markup).toContain('data-student-360-layout="overlay"');
    expect(markup).toContain("width:min(94vw,46rem)");
    expect(markup).toContain(`aria-label="${zh.school.student360.close}"`);
    expect(markup.match(/<div\b[^>]*id="student-360-resize"[^>]*>/)?.[0]).toContain('aria-disabled="true"');
    expect(markup.match(/aria-label="主表草稿"/g)).toHaveLength(1);
    expect(markup.match(/aria-label="侧页草稿"/g)).toHaveLength(1);
    expect(markup).toMatch(/<\/div><button\b[^>]*>[\s\S]*?<\/button><aside\b/);
  });
});
