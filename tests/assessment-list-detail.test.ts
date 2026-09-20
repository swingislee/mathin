// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssessmentLoadedDetails } from "@/features/school/AssessmentLoadedDetails";
import type { AssessmentWorkbenchRow } from "@/features/school/assessment-workbench-contract";

const state = vi.hoisted(() => ({ load: vi.fn(), shown: null as AssessmentWorkbenchRow | null }));
vi.mock("@/features/school/assessment-list-actions", () => ({ getAssessmentListDetailAction: state.load }));
vi.mock("@/features/school/AssessmentRecordDetails", () => ({ AssessmentRecordDetails: (props: { row: AssessmentWorkbenchRow }) => { state.shown = props.row; return null; } }));
vi.mock("@/features/school/SourceCompletionNotice", () => ({ SourceCompletionNotice: () => null }));
const summary = { id: "registration:one", listSummary: true, participationStatus: "booked" } as AssessmentWorkbenchRow;
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); state.load.mockReset(); state.shown = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (row: AssessmentWorkbenchRow, onLoaded = vi.fn()) => {
  await act(async () => root.render(createElement(AssessmentLoadedDetails, { row, locale: "zh", onLoaded, onSaved: vi.fn() } as unknown as ComponentProps<typeof AssessmentLoadedDetails>)));
};

it("loads an expanded summary once, retries failures and uses subsequent saved parent data", async () => {
  const full = { ...summary, listSummary: undefined, assessorName: "first" }, loaded = vi.fn();
  state.load.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" }).mockResolvedValueOnce({ ok: true, data: full });
  await render(summary, loaded);
  expect(state.shown).toBeNull(); expect(container.textContent).toContain("重试");
  await act(async () => container.querySelector("button")!.click());
  expect(state.load).toHaveBeenCalledTimes(2); expect(loaded).toHaveBeenCalledWith(full);
  const saved = { ...full, assessorName: "changed" };
  await render(saved, loaded);
  expect(state.load).toHaveBeenCalledTimes(2); expect(state.shown).toBe(saved);
});

it("does not read full rows again and ignores an unmounted request result", async () => {
  await render({ ...summary, listSummary: undefined }); expect(state.load).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void; const loaded = vi.fn();
  state.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(summary, loaded);
  await act(async () => root.render(null));
  await act(async () => finish({ ok: true, data: { ...summary, listSummary: undefined } }));
  expect(loaded).not.toHaveBeenCalled();
});

it("discards details requested before the same record was refreshed to a newer version", async () => {
  const resolvers: ((value: unknown) => void)[] = [], loaded = vi.fn();
  state.load.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)));
  const old = { ...summary, updatedAt: "2026-09-20T00:00:00Z" }, next = { ...summary, updatedAt: "2026-09-20T01:00:00Z" };
  await render(old, loaded); await render(next, loaded);
  expect(state.load).toHaveBeenCalledTimes(2);
  await act(async () => resolvers[0]({ ok: true, data: { ...old, listSummary: undefined } }));
  expect(loaded).not.toHaveBeenCalled(); expect(state.shown).toBeNull();
  const full = { ...next, listSummary: undefined };
  await act(async () => resolvers[1]({ ok: true, data: full }));
  expect(loaded).toHaveBeenCalledWith(full); expect(state.shown).toBe(full);
});
