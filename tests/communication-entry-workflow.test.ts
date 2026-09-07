// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "../messages/zh.json";
import en from "../messages/en.json";
import { CommunicationWorkToolbar } from "@/features/school/CommunicationWorkToolbar";
import { CommunicationWorkSelectionProvider } from "@/features/school/CommunicationWorkSelection";

const actions = vi.hoisted(() => ({ replace: vi.fn(), create: vi.fn(), query: "scope=mine&pageSize=50" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(actions.query) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace: actions.replace }) }));
vi.mock("@/features/school/communication-workday-actions", () => ({ createCommunicationWorklistAction: actions.create }));

let root: Root, container: HTMLDivElement;
const today = "2026-09-07";
const pageKeys = Array.from({ length: 35 }, (_, index) => `lead:${index}`);
async function renderToolbar(selected: string[] = [], props: Partial<ComponentProps<typeof CommunicationWorkToolbar>> = {}, locale: "zh" | "en" = "zh") {
  const toolbar = createElement(CommunicationWorkToolbar, {
    options: { view: "unscheduled", date: today }, scope: "mine", canViewAll: true, canManage: true,
    worklists: [], pageKeys, count: pageKeys.length, today, ...props,
  });
  const selectionProps = { initialSelectedKeys: selected, children: toolbar };
  const children: ReactNode = createElement(CommunicationWorkSelectionProvider, selectionProps);
  const provider: ComponentProps<typeof NextIntlClientProvider> = { locale, messages: locale === "zh" ? zh : en, timeZone: "Asia/Shanghai", children };
  await act(async () => root.render(createElement(NextIntlClientProvider, provider)));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
const click = async (node: HTMLElement) => { expect(node).toBeTruthy(); await act(async () => node.click()); };

describe("first-contact entry workflow", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    vi.clearAllMocks(); actions.query = "scope=mine&pageSize=50";
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it.each(["zh", "en"] as const)("opens a usable queue without a date or a start-round step in %s", async locale => {
    await renderToolbar([], {}, locale);
    const labels = (locale === "zh" ? zh : en).school.communicationWorkday;
    const primary = container.querySelector<HTMLButtonElement>("[data-followup-primary-filter] button")!;
    expect(primary.textContent).toBe(labels.view_unscheduled);
    expect(primary.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.textContent).not.toContain(labels.startRound);
    expect(container.textContent).not.toContain(labels.saveSelected.split(" · ")[0]);
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("saves only explicitly selected contacts and asks for no scheduling date", async () => {
    actions.create.mockResolvedValue({ ok: true, data: { id: "saved-list" } });
    await renderToolbar(["lead:3", "lead:8", "not-actionable"]);
    await click(button("保存联系清单 · 2"));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await click(button(zh.school.communicationWorkday.create));
    expect(actions.create).toHaveBeenCalledExactlyOnceWith({ name: "2026-09-07 联系清单", date: today, keys: ["lead:3", "lead:8"] });
    expect(actions.replace.mock.calls[0][0]).toContain("view=worklist&worklist=saved-list");
  });

  it("resets incompatible column filters when switching views and keeps the visible search and owner", async () => {
    actions.query = 'view=unscheduled&scope=all&q=Sample&page=3&pageSize=100&fields=' + encodeURIComponent(JSON.stringify({ version: 2, filters: { nextContact: { kind: "presence", value: "missing" } }, sort: null }));
    await renderToolbar([], { scope: "all", query: "Sample", hasFieldFilters: true });
    await click(button(zh.school.communicationWorkday.view_records));
    const query = new URL(actions.replace.mock.calls[0][0], "http://example.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ view: "records", scope: "all", q: "Sample", pageSize: "100", state: "current" });
    expect(actions.create).not.toHaveBeenCalled();
  });

  it("offers a clear-filter action and a route to all contacts for an empty queue", async () => {
    actions.query = 'view=unscheduled&scope=mine&q=Sample&page=3&fields=old';
    await renderToolbar([], { count: 0, query: "Sample", hasFieldFilters: true });
    expect(button(zh.school.communicationWorkday.showAll)).toBeTruthy();
    await click(button(zh.school.communicationWorkday.clearFilters));
    const query = new URL(actions.replace.mock.calls[0][0], "http://example.test").searchParams;
    expect(Object.fromEntries(query)).toEqual({ view: "unscheduled", scope: "mine" });
  });
});
