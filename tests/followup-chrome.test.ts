// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { BusinessRecordStateFilter } from "@/features/school/BusinessRecordStateFilter";
import { businessRecordMessages } from "@/features/school/business-record-state-contract";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children),
  useRouter: () => ({ replace: navigation.replace }),
}));

let root: Root, container: HTMLDivElement;
async function render(children: ReactNode, locale: "zh" | "en" = "zh") {
  const provider: ComponentProps<typeof NextIntlClientProvider> = {
    locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children,
  };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
const paging: ComponentProps<typeof LeadPoolPagination> = {
  currentPage: 3, totalPages: 5, totalCount: 450, pageSize: 100, scope: "all", status: "uncontacted",
  q: "Sample", extraQuery: { assignment: "assigned" },
};
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("compact follow-up chrome", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.clearAllMocks();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it("keeps all five headers free of passive totals without removing the footer or batch-selection feedback", () => {
    const files = ["src/app/[locale]/dashboard/followups/leads/page.tsx", "src/app/[locale]/dashboard/followups/communication/page.tsx",
      "src/features/school/AssessmentUnifiedWorkbench.tsx", "src/features/school/EnrollmentPlacementWorkbench.tsx", "src/features/school/RenewalStudentPool.tsx"];
    for (const file of files) {
      const source = read(file);
      expect(source).toMatch(/<DashboardCommandState>\s*<FollowupTabs \/>\s*<\/DashboardCommandState>/);
      expect(source).toContain('density="compact"');
    }
    const leads = read(files[0]);
    expect(leads).not.toContain('workspaceT("count"');
    expect(leads).toContain('bodyClassName="gap-1.5"');
    expect(leads).toContain("<LeadPoolPagination");
    expect(read(files[3])).not.toContain('t("placementCounts"');
    expect(read(files[4])).not.toContain('t("counts"');
    const communication = read("src/features/school/CommunicationWorkToolbar.tsx");
    expect(communication).not.toMatch(/t\("(?:progress|dayCount|count)"/);
    expect(communication).toContain("{worklist.name}");
    expect(read("src/features/school/LeadPoolSelection.tsx")).toContain('t("selectedHidden"');
  });

  it.each(["zh", "en"] as const)("groups footer metadata and 28px navigation without auto-centering in %s", async locale => {
    await render(createElement(LeadPoolPagination, paging), locale);
    const t = (locale === "zh" ? zh : en).school.leads;
    const footer = container.querySelector("[data-followup-pagination]")!;
    const nav = footer.querySelector("nav")!;
    expect(footer.className).toContain("justify-end");
    expect(nav.className).toContain("mx-0");
    expect(nav.className).not.toContain("mx-auto");
    expect(nav.className).not.toContain("ml-auto");
    expect(footer.textContent).toContain(locale === "zh" ? "450 条 · 3/5 页" : "450 rows · 3/5");
    expect(container.querySelector('[role="combobox"]')?.className).toContain("h-7");
    expect(nav.querySelectorAll('[data-slot="pagination-link"]')).toHaveLength(7);
    expect([...nav.querySelectorAll('[data-slot="pagination-link"]')].every(node => node.className.includes("size-7"))).toBe(true);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("3");
    for (const label of [t.previous, t.next]) {
      const link = [...nav.querySelectorAll("a")].find(node => node.getAttribute("aria-label") === label)!;
      expect(link.textContent).toBe("");
      expect(link.title).toBe(label);
    }
    const next = [...nav.querySelectorAll("a")].find(node => node.getAttribute("aria-label") === t.next)!;
    const query = new URL(next.href).searchParams;
    expect(Object.fromEntries(query)).toEqual({ assignment: "assigned", scope: "all", status: "uncontacted", q: "Sample", page: "4" });
  });

  it("disables the boundary arrows and retains ellipsis navigation for a long list", async () => {
    await render(createElement(LeadPoolPagination, { ...paging, currentPage: 1, totalPages: 25 }));
    const previous = container.querySelector(`[aria-label="${zh.school.leads.previous}"]`)!;
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.getAttribute("href")).toBeNull();
    expect(previous.getAttribute("tabindex")).toBe("-1");
    expect(container.querySelector('[data-slot="pagination-ellipsis"]')).toBeTruthy();
    await render(createElement(LeadPoolPagination, { ...paging, currentPage: 25, totalPages: 25 }));
    const next = container.querySelector(`[aria-label="${zh.school.leads.next}"]`)!;
    expect(next.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("href")).toBeNull();
  });

  it("resets the page size to page one while retaining communication scope, date, worklist, focus and query", async () => {
    await render(createElement(LeadPoolPagination, { ...paging, baseHref: "/dashboard/followups/communication", scope: "mine",
      focusLeadId: "focused-lead", status: undefined, extraQuery: { view: "worklist", date: "2026-09-07", worklist: "fixed-list", state: "current" } }));
    const trigger = container.querySelector('[role="combobox"]')!;
    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === "50 条/页")!;
    expect(option).toBeTruthy();
    await act(async () => option.click());
    expect(navigation.replace).toHaveBeenCalledOnce();
    const url = new URL(navigation.replace.mock.calls[0][0], "http://example.test");
    expect(url.pathname).toBe("/dashboard/followups/communication");
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: "worklist", date: "2026-09-07", worklist: "fixed-list", state: "current",
      scope: "mine", q: "Sample", lead: "focused-lead", pageSize: "50" });
  });

  it.each(["zh", "en"] as const)("names record scope explicitly in %s and preserves other pages' default presentation", async locale => {
    const onChange = vi.fn();
    await render(createElement(BusinessRecordStateFilter, { value: "historical", onChange, locale, presentation: "followup" }), locale);
    let trigger = container.querySelector('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe(locale === "zh" ? "记录范围" : "Record scope");
    expect(trigger.textContent).toBe(locale === "zh" ? "历史记录" : "Historical records");
    expect(trigger.className).toContain("w-auto");
    await render(createElement(BusinessRecordStateFilter, { value: "historical", onChange, locale }), locale);
    trigger = container.querySelector('[role="combobox"]')!;
    expect(trigger.getAttribute("aria-label")).toBe(businessRecordMessages(locale).state);
    expect(trigger.textContent).toBe(businessRecordMessages(locale).historical);
    expect(trigger.className).toContain("w-32");
    expect(onChange).not.toHaveBeenCalled();
  });
});
