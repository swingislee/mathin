// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import { SpatialTeachingContentEditor } from "@/features/teacher-microcourses/SpatialTeachingContentEditor";
import type { DiceTeachingSnapshot } from "@/features/tools/courseware/spatial-teaching-content";
import { diceTool } from "./fixtures/spatial-teaching-content";

const workspace = vi.hoisted(() => ({ current: null as null | { initial?: DiceTeachingSnapshot; onSnapshot: (snapshot: DiceTeachingSnapshot | null) => void; courseware: boolean } }));
vi.mock("next/dynamic", () => ({ default: () => function WorkspaceStub(props: NonNullable<typeof workspace.current>) { workspace.current = props; return null; } }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); workspace.current = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("courseware starting-scene editor", () => {
  it("waits for a complete scene, copies it, and does not reinitialize the ongoing workbench", async () => {
    const tool = diceTool(), ready = vi.fn();
    await act(async () => {
      // eslint-disable-next-line react/no-children-prop
      root.render(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC", children:
        createElement(SpatialTeachingContentEditor, { version: "dice-lesson-v1", existing: tool, onReady: ready }) }));
    });
    expect(ready.mock.lastCall![0]).toBeNull();
    const initial = workspace.current!.initial;
    expect(initial).toBe(tool.payload.initial);
    expect(workspace.current!.courseware).toBe(true);
    const changed = structuredClone(tool.payload.initial); changed.arrows = true;
    await act(async () => workspace.current!.onSnapshot(changed));
    expect(ready.mock.lastCall![0].payload.initial).toEqual(changed);
    expect(ready.mock.lastCall![0].payload.initial).not.toBe(changed);
    expect(workspace.current!.initial).toBe(initial);
    await act(async () => workspace.current!.onSnapshot(null));
    expect(ready.mock.lastCall![0]).toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(tool.payload.initial.arrows).toBe(false);
  });
});
