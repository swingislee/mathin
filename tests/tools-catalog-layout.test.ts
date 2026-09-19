// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import ToolsPage from "@/app/[locale]/tools/page";
import { tools } from "@/features/tools/registry";

const request = vi.hoisted(() => ({ locale: "zh" as "zh" | "en" }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: (locale: "zh" | "en") => { request.locale = locale; },
  getTranslations: async (namespace: "nav" | "tools") => createTranslator({ locale: request.locale, messages: request.locale === "en" ? en : zh, namespace }),
}));
vi.mock("@/components/site-header", () => ({ SiteHeader: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => createElement("a", { ...props, href: `/${request.locale}${href}` }),
}));

describe.each(["zh", "en"] as const)("%s tools catalog scrolling contract", (locale) => {
  it("keeps every registered tool, including the last row, in the page flow", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(await ToolsPage({ params: Promise.resolve({ locale }) }));
    const main = host.querySelector("main")!;
    const catalog = main.querySelector("section")!;
    const links = [...catalog.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(tools.map(({ id }) => `/${locale}/tools/${id}`));
    expect(links.at(-1)!.textContent).toContain((locale === "en" ? en : zh).tools.items.projection.name);
    // 桌面断点也保留内容高度，不再由绝对定位和一屏高度裁掉后续行。
    for (const element of [main, catalog]) {
      const utilities = [...element.classList].map((name) => name.split(":").at(-1));
      expect(utilities).not.toContain("absolute");
      expect(utilities).not.toContain("fixed");
      expect(utilities.some((name) => /^(?:max-)?h-/.test(name ?? ""))).toBe(false);
      expect(utilities).not.toContain("overflow-hidden");
      expect(utilities).not.toContain("overflow-y-hidden");
      expect(utilities).not.toContain("overflow-y-auto");
    }
    expect(catalog.classList.contains("pb-20")).toBe(true);
  });

  it("keeps the illustration viewport-sized and non-interactive outside the scrolling list", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(await ToolsPage({ params: Promise.resolve({ locale }) }));
    const backdrop = host.querySelector(".scene-illustration")!.parentElement!;
    expect(backdrop.classList.contains("fixed")).toBe(true);
    expect(backdrop.classList.contains("pointer-events-none")).toBe(true);
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.contains(host.querySelector("section"))).toBe(false);
    expect(host.querySelector(".scene-adaptive.scene-tools")).not.toBeNull();
  });
});
