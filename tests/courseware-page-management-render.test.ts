// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { FormalCoursewarePageActions } from "@/features/courseware-studio/FormalCoursewarePageActions";
import { CoursewareWorkbench, CoursewareWorkbenchPageActions } from "@/features/courseware-doc/CoursewareEditorWorkbench";
import { CoursewareEditorAdapterSurface } from "@/features/courseware-doc/CoursewareEditorAdapterSurface";

const actions = vi.hoisted(() => ({ remove: vi.fn(), reorder: vi.fn() }));
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
const measureRef = vi.hoisted(() => ({ current: null }));
vi.mock("@/features/courseware-studio/formal-page-management-actions", () => ({ deleteFormalCoursewarePageAction: actions.remove, reorderFormalCoursewarePagesAction: actions.reorder }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children }: { children: ReactNode }) => createElement("div", null, children), useRouter: () => router }));
vi.mock("@/hooks/use-panel-layout", () => ({ usePanelLayout: () => ({ groupRef: null, onLayoutChanged: () => {} }) }));
vi.mock("@/hooks/use-split-orientation", () => ({ useSplitOrientation: () => [measureRef, "horizontal"] }));
vi.mock("@/features/courseware-doc/CoursewareStageViewport", () => ({ CoursewareStageViewport: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/components/ui/resizable", () => ({ ResizablePanel: ({ children }: { children: ReactNode }) => createElement("div", null, children), ResizablePanelGroup: ({ children }: { children: ReactNode }) => createElement("div", null, children), ResizableHandle: () => null }));
const items = ["a", "b", "c"].map((id) => ({ id, href: `/editor?pageId=${id}` }));
const labels = en.coursewareWorkspace.pageManagement;
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); actions.remove.mockReset(); actions.reorder.mockReset(); router.replace.mockReset(); router.refresh.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(child: ReactNode) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, children: child })));
}
function footerButton(label: string) { return host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement; }
describe("shared page management", () => {
  it("disables boundaries and moves the complete list while preserving the selected stable URL", async () => {
    actions.reorder.mockResolvedValue({ ok: true });
    await mount(createElement(FormalCoursewarePageActions, { lectureId: "lecture", items, selectedIndex: 0 }));
    expect(footerButton(labels.moveUp).disabled).toBe(true);
    await act(async () => footerButton(labels.moveDown).click());
    expect(actions.reorder).toHaveBeenCalledWith({ lectureId: "lecture", pageIds: ["b", "a", "c"] });
    expect(router.replace).toHaveBeenCalledWith(items[0].href);
  });
  it("requires confirmation, preserves failed deletion, and selects the next page on success", async () => {
    await mount(createElement(FormalCoursewarePageActions, { lectureId: "lecture", items, selectedIndex: 1 }));
    await act(async () => footerButton(labels.delete).click());
    expect(actions.remove).not.toHaveBeenCalled();
    const confirm = () => [...document.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === labels.delete) as HTMLButtonElement;
    actions.remove.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    await act(async () => confirm().click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    actions.remove.mockResolvedValue({ ok: true });
    await act(async () => confirm().click());
    expect(actions.remove).toHaveBeenLastCalledWith({ pageDocId: "b" });
    expect(router.replace).toHaveBeenCalledWith(items[2].href);
  });
  it("keeps the formal last-page rule and empty-list controls disabled", async () => {
    await mount(createElement(FormalCoursewarePageActions, { lectureId: "lecture", items: items.slice(0, 1), selectedIndex: 0 }));
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
    await mount(createElement(FormalCoursewarePageActions, { lectureId: "lecture", items: [], selectedIndex: -1 }));
    expect([...host.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });
  it("blocks page mutations while the shared editor reports unsaved content", async () => {
    const footer = createElement(CoursewareWorkbenchPageActions, { selectedIndex: 1, total: 3, onMove: vi.fn(), onDelete: vi.fn() });
    // eslint-disable-next-line react/no-children-prop
    const surface = createElement(CoursewareEditorAdapterSurface, { toolbar: null, saveControls: null, inspector: null, aspect: 4 / 3, pageActionsDisabled: true, children: null });
    await mount(createElement(CoursewareWorkbench, { mode: "formal-editor", adapter: "test", layout: "workspace",
      directory: { ariaLabel: "Pages", header: null, content: null, footer }, canvas: { ariaLabel: "Canvas", content: surface, actions: createElement("span", { "data-publication-control": true }, "Publish") }, inspector: { ariaLabel: "Properties", header: null } }));
    expect([...host.querySelectorAll("[data-courseware-page-actions] button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(host.querySelector("[data-publication-control]")?.closest('[data-courseware-editor-part="lecture-actions"]')).not.toBeNull();
    expect(host.querySelector("[data-publication-control]")?.closest('[data-courseware-editor-slot="toolbar"]')).toBeNull();
    expect(host.querySelector("[data-courseware-workbench]")?.classList.contains("flex-col")).toBe(true);
  });
});
