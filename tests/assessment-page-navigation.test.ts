// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssessmentPagedWorkbench } from "@/features/school/AssessmentPagedWorkbench";
import type { AssessmentUnifiedWorkbench } from "@/features/school/AssessmentUnifiedWorkbench";

const state = vi.hoisted(() => ({ search: "page=3&pageSize=50", replace: vi.fn(), props: null as ComponentProps<typeof AssessmentUnifiedWorkbench> | null }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/dashboard/assessments", useRouter: () => ({ replace: state.replace }) }));
vi.mock("@/features/school/AssessmentUnifiedWorkbench", () => ({ AssessmentUnifiedWorkbench: (props: ComponentProps<typeof AssessmentUnifiedWorkbench>) => { state.props = props; return null; } }));
let root: Root, container: HTMLDivElement;
const props: ComponentProps<typeof AssessmentPagedWorkbench> = { locale: "zh", canAssess: true, canSupport: true, canManageAssessor: true, assessors: [],
  data: { rows: [], count: 930, page: 3, pageSize: 50, totalPages: 19, q: "", state: "current", fieldView: { query: { version: 2, filters: {}, sort: null }, facets: {} } } };
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers();
  state.search = "page=3&pageSize=50"; state.replace.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(AssessmentPagedWorkbench, props)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it("merges fast search and field changes into one request and resets page", async () => {
  await act(async () => {
    state.props!.pageControl!.onSearch("Sample");
    state.props!.pageControl!.onFields({ version: 2, filters: { grade: { kind: "enum", values: ["3"] } }, sort: null });
    await vi.advanceTimersByTimeAsync(260);
  });
  expect(state.replace).toHaveBeenCalledTimes(1);
  const url = new URL(state.replace.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("q")).toBe("Sample"); expect(url.searchParams.has("page")).toBe(false);
  expect(JSON.parse(url.searchParams.get("fields")!).filters.grade.values).toEqual(["3"]);
});

it("preserves state and column conditions on a later page without slicing the returned page again", async () => {
  await act(async () => {
    state.props!.pageControl!.onState("historical");
    state.props!.pageControl!.onPage(2, 20);
    await vi.advanceTimersByTimeAsync(1);
  });
  const url = new URL(state.replace.mock.calls[0][0], "https://example.test");
  expect(url.searchParams.get("state")).toBe("historical"); expect(url.searchParams.get("page")).toBe("2");
  expect(state.props!.initialRows).toBe(props.data.rows); expect(state.props!.pageControl!.data.count).toBe(930);
});

it("cancels pending search when browser history supplies a different route", async () => {
  await act(async () => state.props!.pageControl!.onSearch("unfinished"));
  state.search = "page=1&state=historical";
  await act(async () => root.render(createElement(AssessmentPagedWorkbench, { ...props, data: { ...props.data, page: 1, state: "historical" } })));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(state.replace).not.toHaveBeenCalled(); expect(state.props!.pageControl!.q).toBe("");
});
