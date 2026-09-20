import { readFileSync } from "node:fs";
import { createElement, type ComponentProps, type ComponentType, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { TeachingRecordsCommandPanel } from "../src/features/school/teaching-workbench/TeachingRecordsCommandPanel";
import { teachingTimeWindow } from "../src/features/school/teaching-workbench/teaching-period-contract";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a"> & { prefetch?: boolean; scroll?: boolean }) => {
    delete props.prefetch; delete props.scroll;
    return createElement("a", props, children);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
const Provider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>;
const window = teachingTimeWindow("week", "previous", undefined, [], "Asia/Shanghai", new Date("2026-09-15T04:00:00Z"));

describe("teaching records shared command panel", () => {
  it("keeps class navigation and grouping in one layout slot", () => {
    const html = renderToStaticMarkup(createElement(Provider, { locale: "zh", messages: zh, timeZone: "Asia/Shanghai" }, createElement(TeachingRecordsCommandPanel, {
      groupBy: "teacher", grain: "week", window, baseHref: "/dashboard/classes?view=records", terms: [], today: "2026-09-15", selection: "previous",
      navigation: createElement("a", { href: "/dashboard/classes" }, "班级名册"),
    })));
    expect(html.match(/data-dashboard-command-slot="state"/g)).toHaveLength(1);
    expect(html).toContain("班级名册");
    expect(html).toContain(zh.school.teachingWorkbench.grouping.byTeacher);
  });
  it.each(["zh", "en"] as const)("keeps grouping before time controls for both entry points (%s)", locale => {
    const messages = locale === "zh" ? zh : en;
    const t = messages.school.teachingWorkbench;
    for (const path of ["/dashboard/teaching", "/dashboard/teaching/review"]) {
      const html = renderToStaticMarkup(createElement(Provider, { locale, messages, timeZone: "Asia/Shanghai" }, createElement(TeachingRecordsCommandPanel, {
        groupBy: "grade", grain: "week", window, baseHref: `${path}?view=records&group=grade&period=week&date=previous&teacher=chosen`, terms: [], today: "2026-09-15", selection: "previous",
        links: [{ value: "tasks", label: t.myTasks, href: "/dashboard/teaching?view=tasks" }],
      })));
      expect(html.indexOf(t.grouping.byGrade)).toBeLessThan(html.indexOf(t.time.dimension));
      expect(html).toContain("2026-09-07 — 2026-09-13");
      expect(html).toContain("group=teacher&amp;period=week&amp;date=previous&amp;teacher=chosen");
      expect(html).toContain(`aria-label="${t.views}"`);
      expect(html).not.toContain(t.myTasks);
      expect(html).not.toContain(t.records.title);
      expect(html).toContain('aria-current="date"');
    }
  });

  it("wires live and replay routes to the shared panel and preserves the selected time grain", () => {
    const live = readFileSync("src/features/school/teaching-workbench/TeachingWorkspacePage.tsx", "utf8");
    const replay = readFileSync("src/app/[locale]/dashboard/classes/review/page.tsx", "utf8");
    for (const source of [live, replay]) expect(source).toContain("<TeachingRecordsCommandPanel");
    expect(live).toContain('view === "records" ? "previous" : "current"');
    expect(live).toContain('<ClassWorkspaceTabs active="records"');
    expect(live).not.toContain('progressHref(window.date, "month", "records")');
  });
});
