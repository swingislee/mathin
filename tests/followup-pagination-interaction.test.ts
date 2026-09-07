// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { LeadPoolPagination } from "@/features/school/LeadPoolPagination";
import { useFollowupPagination } from "@/features/school/useFollowupPagination";
import { useFollowupServerFields } from "@/features/school/useFollowupServerFields";
import { useDashboardFieldView } from "@/features/school/dashboard-page/useDashboardFieldView";
import type { DashboardFieldQuery } from "@/features/school/dashboard-page/dashboard-table-field-contract";
import type { FollowupServerFields } from "@/features/school/followup-table-page";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }), usePathname: () => "/dashboard/followups/leads",
  Link: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("scope=mine&page=3&pageSize=50") }));
const empty: DashboardFieldQuery = { version: 2, filters: {}, sort: null };
const allRows = Array.from({ length: 105 }, (_, id) => ({ id, name: `Name ${id}` }));
const fields = { name: { kind: "text" as const, label: "Name", value: (row: typeof allRows[number]) => row.name } };
const context = { locale: "en", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-07T01:00:00Z") };
let root: Root, container: HTMLDivElement;
async function render(children: React.ReactNode) {
  const provider = { locale: "en", messages: en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); };
function Local({ view = "all", count = 105 }: { view?: string; count?: number }) {
  const page = useFollowupPagination(allRows.slice(0, count), view);
  return createElement("div", null, createElement("output", null, page.rows.map(row => row.id).join(",")),
    createElement("button", { onClick: () => page.onPageChange(page.page, 20) }, "Size 20"),
    createElement(LeadPoolPagination, { currentPage: page.page, totalPages: page.totalPages, totalCount: page.count, pageSize: page.pageSize, onPageChange: page.onPageChange }));
}
function Server({ data }: { data: FollowupServerFields }) {
  const server = useFollowupServerFields(data);
  const table = useDashboardFieldView({ rows: allRows.slice(0, 2), fields, columns: { name: ["name"] }, context, server });
  return createElement("div", null, createElement("output", { "data-query": true }, JSON.stringify(table.filters)),
    createElement("output", { "data-count": true }, table.visibleRows.length),
    createElement("button", { onClick: () => table.setFilter("name", { kind: "text", query: "not on this page" }) }, "Query"));
}
describe("shared follow-up pagination and server query interaction", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    navigation.replace.mockReset();
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  it("renders 50 rows, navigates without a route write, and resets when a view changes or data shrinks", async () => {
    await render(createElement(Local, {}));
    expect(container.querySelector("output")!.textContent!.split(",")).toHaveLength(50);
    expect(container.querySelector("[data-followup-pagination]")?.getAttribute("data-page-size")).toBe("50");
    await click(container.querySelector<HTMLAnchorElement>('a[aria-label="'+en.school.leads.next+'"]'));
    expect(container.querySelector("output")!.textContent!.split(",")[0]).toBe("50");
    expect(navigation.replace).not.toHaveBeenCalled();
    await render(createElement(Local, { view: "filtered", count: 4 }));
    expect(container.querySelector("[data-followup-pagination]")?.getAttribute("data-page")).toBe("1");
    await render(createElement(Local, {}));
    expect(container.querySelector("[data-followup-pagination]")?.getAttribute("data-page")).toBe("1");
    await click(container.querySelector<HTMLAnchorElement>('a[aria-label="'+en.school.leads.next+'"]'));
    await render(createElement(Local, { count: 4 }));
    await render(createElement(Local, {}));
    expect(container.querySelector("[data-followup-pagination]")?.getAttribute("data-page")).toBe("1");
    await click([...container.querySelectorAll("button")].find(button => button.textContent === "Size 20")!);
    expect(container.querySelector("output")!.textContent!.split(",")).toHaveLength(20);
  });
  it("debounces server filters, resets the URL page and accepts server/back navigation without client page filtering", async () => {
    vi.useFakeTimers();
    const data = { query: empty, facets: {} };
    await render(createElement(Server, { data }));
    await click(container.querySelector("button"));
    expect(container.querySelector("[data-count]")?.textContent).toBe("2");
    await act(async () => vi.advanceTimersByTime(180));
    const url = new URL(navigation.replace.mock.calls[0][0], "http://example.test");
    expect(url.searchParams.has("page")).toBe(false); expect(url.searchParams.get("scope")).toBe("mine");
    const next = JSON.parse(url.searchParams.get("fields")!);
    expect(next.filters.name).toEqual({ kind: "text", query: "not on this page" });
    await render(createElement(Server, { data: { ...data, query: next } }));
    await render(createElement(Server, { data }));
    expect(container.querySelector("[data-query]")?.textContent).toBe("{}");
  });
});
