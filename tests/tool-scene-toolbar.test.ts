// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { ToolSceneEditor } from "@/features/tools/scenes/ToolSceneEditor";
import { ToolDraftError } from "@/features/tools/scenes/draft-store";
import { projectionTool } from "./fixtures/projection-tool";
import { createCubeCoursewareTool } from "@/features/tools/courseware/cube-structures-content";
import { cubeDraftSnapshot } from "@/features/tools/spatial-lab/cube-structures-draft";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";

const store = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), read: vi.fn() }));
const workspace = vi.hoisted(() => ({ capture: null as null | ((value: unknown) => void), import: null as null | ((value: unknown) => void) }));
vi.mock("@/features/tools/scenes/draft-store", async (original) => ({ ...await original<object>(), createToolDraftStore: () => store }));
vi.mock("next/dynamic", () => ({ default: () => function WorkspaceStub(props: { onSnapshot?: (value: unknown) => void; onReady?: (value: unknown) => void }) {
  if (props.onReady) workspace.import = props.onReady; else workspace.capture = props.onSnapshot ?? null;
  return null;
} }));
let root: Root, host: HTMLDivElement;
const initial = projectionTool();
const saved = { id: "20000000-0000-4000-8000-000000000001", name: initial.payload.title, catalogId: "projection", revision: 1, createdAt: "2026-09-19T00:00:00Z", updatedAt: "2026-09-19T00:00:00Z", scene: initial };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); store.list.mockResolvedValue([saved]); store.save.mockResolvedValue(saved);
  workspace.capture = null; workspace.import = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(existing = initial as Parameters<typeof ToolSceneEditor>[0]["existing"]) {
  // eslint-disable-next-line react/no-children-prop
  await act(async () => root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: createElement(ToolSceneEditor, { version: existing!.contentVersion, existing, fullHeight: true }) })));
}
function button(label: string, scope: ParentNode = host) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  expect(result).toBeDefined(); return result!;
}
async function click(label: string, scope: ParentNode = host) { await act(async () => button(label, scope).click()); }

describe("single-row Tools preparation toolbar", () => {
  it("keeps scene actions, picker and name in one fixed-height row while dragging only disables save", async () => {
    await render();
    const toolbar = host.querySelector("[data-tool-scene-toolbar]")!;
    expect(toolbar.classList.contains("h-12")).toBe(true);
    expect(toolbar.classList.contains("flex-nowrap")).toBe(true);
    expect(toolbar.classList.contains("overflow-x-auto")).toBe(true);
    expect(host.querySelector("input")!.closest("[data-tool-scene-toolbar]")).toBe(toolbar);
    expect(button(en.tools.preparation.save).disabled).toBe(true);
    await act(async () => workspace.capture!(initial.payload.initial));
    await click(en.tools.preparation.library);
    expect(host.querySelector('[role="combobox"]')?.closest("[data-tool-scene-toolbar]")).toBe(toolbar);
    expect(button(en.tools.preparation.open).closest("[data-tool-scene-toolbar]")).toBe(toolbar);
    expect(button(en.tools.preparation.open).classList.contains("whitespace-nowrap")).toBe(true);
    await click(en.tools.preparation.save);
    expect(store.save).toHaveBeenCalledExactlyOnceWith(initial, undefined);
    const configuration = host.querySelector("[data-tool-scene-configuration]")!;
    const stage = configuration.firstElementChild;
    await act(async () => workspace.capture!(null));
    expect(button(en.tools.preparation.save).disabled).toBe(true);
    expect(configuration.children).toHaveLength(1); expect(configuration.firstElementChild).toBe(stage);
    expect(host.textContent).not.toContain(en.tools.preparation.wait);
    await act(async () => workspace.capture!(initial.payload.initial));
    expect(button(en.tools.preparation.save).disabled).toBe(false);
    await click(en.tools.preparation.save);
    expect(store.save.mock.lastCall![1]).toMatchObject({ id: saved.id, revision: 1 });
    expect(host.querySelector("[data-tool-scene-toolbar]")).toBe(toolbar);
  });

  it("keeps actual save errors visible outside normal layout flow", async () => {
    store.save.mockRejectedValueOnce(new ToolDraftError("conflict"));
    await render(); await act(async () => workspace.capture!(initial.payload.initial));
    await click(en.tools.preparation.save);
    const error = host.querySelector('[role="alert"]')!;
    expect(error.textContent).toBe(en.tools.preparation.errors.conflict);
    expect(error.classList.contains("absolute")).toBe(true);
    expect(host.querySelector("[data-tool-scene-configuration]")!.children).toHaveLength(1);
  });

  it("opens legacy cube import as a floating panel and restores the imported scene name", async () => {
    const cube = createCubeCoursewareTool({ name: "Cube", snapshot: cubeDraftSnapshot(createCubeSession([{ x: 0, y: 0, z: 0 }]), 0) }, "current");
    await render(cube);
    const toolbar = host.querySelector("[data-tool-scene-toolbar]")!;
    expect(button(en.tools.preparation.legacyCube).closest("[data-tool-scene-toolbar]")).toBe(toolbar);
    await click(en.tools.preparation.legacyCube);
    const popover = document.querySelector(`[role="dialog"][aria-label="${en.tools.preparation.legacyCube}"]`)!;
    expect(popover).not.toBeNull(); expect(toolbar.contains(popover)).toBe(false);
    const imported = { ...cube, payload: { ...cube.payload, title: "Imported structure" } };
    await act(async () => workspace.import!(imported));
    await click(en.tools.preparation.open, popover);
    expect(host.querySelector("input")!.value).toBe(imported.payload.title);
    expect(document.querySelector(`[aria-label="${en.tools.preparation.legacyCube}"][role="dialog"]`)).toBeNull();
  });
});
