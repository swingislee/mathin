// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { DashboardTableColumnHeader } from "@/features/school/dashboard-page/DashboardTableColumnHeader";
import { DashboardPreferenceScope } from "@/features/school/dashboard-page/DashboardPreferenceScope";
import { useDashboardFieldView } from "@/features/school/dashboard-page/useDashboardFieldView";
import { dashboardFieldMessages } from "@/features/school/dashboard-page/dashboard-field-messages";
import type { DashboardFieldDefinitions, DashboardFieldQuery } from "@/features/school/dashboard-page/dashboard-table-field-contract";

const notify = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("sonner", () => ({ toast: notify }));
type Row = { id: string; name: string; date: string; teacher: string; paper: string; score: number };
const rows: Row[] = [
  { id: "a", name: "Alpha One", date: "2026-09-07T01:00:00Z", teacher: "t1", paper: "p20", score: 18 },
  { id: "b", name: "Beta", date: "2026-09-07T08:00:00Z", teacher: "t2", paper: "p100", score: 18 },
  { id: "c", name: "Alpha Two", date: "2026-09-08T01:00:00Z", teacher: "t1", paper: "p20", score: 0 },
];
const fields: DashboardFieldDefinitions<Row> = {
  name: { kind: "text", label: "Name", value: row => row.name },
  date: { kind: "date", label: "Date", value: row => row.date },
  teacher: { kind: "enum", label: "Teacher", values: row => [{ value: row.teacher, label: row.teacher }] },
  paper: { kind: "enum", label: "Paper", multiple: false, values: row => [{ value: row.paper, label: row.paper }] },
  score: { kind: "number", label: "Score", requiresSingleValue: "paper", value: row => row.score },
};
const columns = { person: ["name"], arrangement: ["date", "teacher"], result: ["paper", "score"] };
const migrated: DashboardFieldQuery = { version: 2, filters: { name: { kind: "text", query: "Alpha" } }, sort: null };
const migrate = () => migrated;
function Harness({ locale }: { locale: "zh" | "en" }) {
  const table = useDashboardFieldView({ rows, fields, columns, context: { locale, timeZone: "Asia/Shanghai", now: Date.parse("2026-09-07T02:00:00Z") }, persistenceKey: "field-test", migrate });
  return createElement("div", null,
    ...Object.keys(columns).map(column => createElement(DashboardTableColumnHeader, { key: column, label: column, ...table.columnProps(column as keyof typeof columns) })),
    createElement("output", { "data-query": true }, JSON.stringify({ version: 2, filters: table.filters, sort: table.sort })),
    createElement("output", { "data-rows": true }, table.visibleRows.map(row => row.id).join(",")));
}
let root: Root, container: HTMLDivElement;
async function render(locale: "zh" | "en" = "en", userId?: string) {
  let children: ReactNode = createElement(Harness, { locale });
  if (userId) {
    const scopeProps = { userId, children };
    children = createElement(DashboardPreferenceScope, scopeProps);
  }
  const providerProps = { locale, timeZone: "Asia/Shanghai", messages: locale === "zh" ? zh : en, children };
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)));
}
const click = async (element: HTMLElement | null | undefined) => { expect(element).toBeTruthy(); await act(async () => element!.click()); };
const byLabel = (label: string) => [...document.querySelectorAll<HTMLElement>("[aria-label]")].find(element => element.getAttribute("aria-label") === label)!;
const panel = (id: string) => document.querySelector<HTMLElement>(`[data-table-field="${id}"]`)!;
const option = (value: string) => document.querySelector<HTMLElement>(`[data-field-option="${value}"]`)!;
const query = (): DashboardFieldQuery => JSON.parse(container.querySelector("[data-query]")!.textContent!);
const visible = () => container.querySelector("[data-rows]")!.textContent;
async function input(element: HTMLInputElement, value: string) {
  expect(element).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function escape() {
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  // Flush Radix's focus restoration after React has committed the closing portal.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe("real field menu and query hook", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    localStorage.clear(); vi.clearAllMocks();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it.each(["zh", "en"] as const)("combines independent fields, keeps the menu open, and separates option search from sorting in %s", async locale => {
    await render(locale); const m = dashboardFieldMessages(locale);
    const trigger = byLabel(`arrangement · ${m.menu}`); await click(trigger);
    const menu = document.querySelector<HTMLElement>("[data-dashboard-field-menu]")!;
    expect(menu.getAttribute("aria-label")).toBe(`arrangement · ${m.menu}`);
    expect(menu.textContent).not.toContain("arrangement");
    for (const removedCopy of [m.scope, m.sortHint, m.combine]) expect(menu.textContent).not.toContain(removedCopy);
    expect(menu.textContent).toContain(m.clearColumn); expect(menu.textContent).toContain(m.clearAll);
    await click(document.querySelector<HTMLElement>('[data-field-date-from="2026-09-07"]'));
    await click(option("t1")); expect(visible()).toBe("a");
    await click(option("t2")); expect(visible()).toBe("a,b");
    expect(document.querySelectorAll("[data-dashboard-field-menu]")).toHaveLength(1);
    await input(byLabel(`Teacher · ${m.choices}`) as HTMLInputElement, "no such teacher");
    expect(byLabel(`Teacher · ${m.ascending}`)).toBeTruthy();
    await click(byLabel(`Date · ${m.descending}`)); expect(visible()).toBe("b,a");
    expect(query().filters.teacher).toEqual({ kind: "enum", values: ["t1", "t2"] });
    await click([...panel("date").querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === m.month));
    expect(query().filters.date).toEqual({ kind: "date", from: "2026-09-07", to: "2026-09-07" });
    await escape(); expect(document.querySelector("[data-dashboard-field-menu]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("uses identity text input, preserves spaces, and clears one column without clearing other conditions", async () => {
    await render(); const m = dashboardFieldMessages("en");
    await click(byLabel(`person · ${m.menu}`));
    expect(panel("name").querySelectorAll('[role="option"]')).toHaveLength(0);
    const name = byLabel(`Name · ${m.search}`) as HTMLInputElement;
    await input(name, "Alpha "); expect(name.value).toBe("Alpha ");
    await input(name, "Alpha One"); expect(visible()).toBe("a");
    await escape(); await click(byLabel(`arrangement · ${m.menu}`));
    await click(option("t1"));
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === m.clearColumn));
    expect(query().filters).toEqual({ name: { kind: "text", query: "Alpha One" } });
    expect(visible()).toBe("a");
    await click([...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === m.clearAll));
    expect(query().filters).toEqual({}); expect(visible()).toBe("a,b,c");
  });

  it("keeps five arrangement fields side by side on desktop and switchable on narrow screens", async () => {
    const m = dashboardFieldMessages("en");
    await act(async () => root.render(createElement(DashboardTableColumnHeader, {
      label: "Arrangement", context: { locale: "en", timeZone: "Asia/Shanghai", now: Date.parse("2026-09-07T02:00:00Z") },
      fields: ["Date", "Location", "Assessor", "Support owner", "Assessor source"].map(label => ({ id: label, label,
        kind: "text" as const, sortable: true, options: [], days: [], onFilterChange: vi.fn(), onSortChange: vi.fn() })),
      onClearColumn: vi.fn(), onClearAll: vi.fn(),
    })));
    await click(byLabel(`Arrangement · ${m.menu}`));
    const panels = [...document.querySelectorAll<HTMLElement>("[data-table-field]")];
    expect(panels).toHaveLength(5);
    expect(panels[0].parentElement!.className).toContain("md:grid-cols-5");
    expect(document.querySelector<HTMLElement>("[data-dashboard-field-menu]")!.style.width).toContain("80rem");
    expect(byLabel(m.fields).className).toContain("md:hidden");
    await click([...byLabel(m.fields).querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Support owner"));
    expect(panel("Support owner").className).not.toContain("hidden");
    expect(panel("Date").className).toContain("hidden md:flex");
  });

  it("validates number ranges and clears dependent score conditions when the paper changes", async () => {
    await render(); const m = dashboardFieldMessages("en"); await click(byLabel(`result · ${m.menu}`));
    expect(panel("score").querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    await click(option("p20"));
    const inputs = panel("score").querySelectorAll<HTMLInputElement>("input");
    await input(inputs[0], "18"); await input(inputs[1], "10");
    let apply = [...panel("score").querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === m.apply)!;
    expect(apply.disabled).toBe(true); expect(query().filters.score).toBeUndefined();
    await input(inputs[1], "18"); apply = [...panel("score").querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === m.apply)!;
    await click(apply); expect(visible()).toBe("a");
    await click(byLabel(`Score · ${m.descending}`));
    // The selected value remains available when the other paper has no score-range matches.
    await click(option("p20")); expect(query().filters.score).toBeUndefined(); expect(query().sort).toBeNull();
    await click(option("p100")); expect(visible()).toBe("b");
  });

  it("migrates account-scoped preferences once without modifying another account", async () => {
    const key = "mathin:dashboard:v1:account-a:field-test", other = "mathin:dashboard:v1:account-b:field-test";
    localStorage.setItem(key, JSON.stringify({ filters: { old: "value" } })); localStorage.setItem(other, "untouched");
    await render("en", "account-a");
    expect(visible()).toBe("a,c"); expect(JSON.parse(localStorage.getItem(key)!)).toEqual(migrated);
    expect(localStorage.getItem(other)).toBe("untouched"); expect(notify.info).toHaveBeenCalledTimes(1);
    await render("zh", "account-a"); expect(notify.info).toHaveBeenCalledTimes(1);
  });
});
