// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { ToolSceneEditor } from "@/features/tools/scenes/ToolSceneEditor";
import { fractionCoursewareSchema, initialFractionScene, initialMotionScene, motionCoursewareSchema } from "@/features/tools/scenes/numeric-teaching-content";
import { diceTool } from "./fixtures/spatial-teaching-content";

const workspace = vi.hoisted(() => ({ current: null as null | { initial?: unknown; onSnapshot: (snapshot: unknown) => void } }));
vi.mock("next/dynamic", () => ({ default: () => function OriginalWorkspaceStub(props: NonNullable<typeof workspace.current>) { workspace.current = props; return null; } }));
vi.mock("@/features/tools/scenes/ToolSceneLibrary", () => ({ ToolSceneLibrary: () => null }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); workspace.current = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
describe("shared starting-scene editor", () => {
  it.each([
    diceTool(),
    fractionCoursewareSchema.parse({ toolId: "fraction-line", contentVersion: "fraction-line-lesson-v1", payload: { title: "Fractions", initial: initialFractionScene() } }),
    motionCoursewareSchema.parse({ toolId: "motion-lab", contentVersion: "motion-lab-lesson-v1", payload: { title: "Motion", initial: initialMotionScene() } }),
  ])("captures $toolId without reinitializing the original workbench or changing its source", async (scene) => {
    const ready = vi.fn();
    await act(async () => {
      // eslint-disable-next-line react/no-children-prop
      root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children: createElement(ToolSceneEditor, { version: scene.contentVersion, existing: scene, onReady: ready }) }));
    });
    expect(ready.mock.lastCall![0]).toBeNull();
    const initial = workspace.current!.initial;
    expect(initial).toBe(scene.payload.initial);
    await act(async () => workspace.current!.onSnapshot(structuredClone(initial)));
    expect(ready.mock.lastCall![0]).toEqual(scene);
    expect(ready.mock.lastCall![0].payload.initial).not.toBe(initial);
    expect(workspace.current!.initial).toBe(initial);
    await act(async () => workspace.current!.onSnapshot(null));
    expect(ready.mock.lastCall![0]).toBeNull();
    expect(workspace.current!.initial).toBe(initial);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });
});
