// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoursewareCompositionGridEditor } from "@/features/courseware-doc/CoursewareCompositionGridEditor";
import { addCoursewareCompositionTool, updateCoursewareCompositionPlacement } from "@/features/courseware-doc/composition-page-layout";
import { createEmptyCoursewareCompositionPage } from "@/features/courseware-doc/composition-page-schema";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/features/courseware-doc/CoursewareCompositionStage", () => ({ default: ({ className }: { className: string }) => createElement("div", { className, "data-stage-probe": true }) }));
const inserted = addCoursewareCompositionTool(createEmptyCoursewareCompositionPage(), { toolId: "spatial-lab", contentVersion: "tool-embed-v1" });
const doc = updateCoursewareCompositionPlacement(inserted, inserted.layout.blocks[0].id, { column: 0, row: 0, columnSpan: 6, rowSpan: 4 });
const block = doc.layout.blocks[0];
let root: Root, host: HTMLDivElement;
let reportWidth: (width: number) => void;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: (entries: unknown[]) => void) { reportWidth = (width) => callback([{ contentRect: { width } }]); }
    observe() { reportWidth(960); }
    disconnect() {}
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount(selectedBlockId: string | null = block.id, onChange = vi.fn()) {
  await act(async () => root.render(createElement(CoursewareCompositionGridEditor, {
    doc, selectedBlockId, bindingUrls: {}, onSelectBlock: vi.fn(), onChange,
    onNodeTransformChange: vi.fn(), onNodeTextChange: vi.fn(), snapToGrid: true,
  } satisfies ComponentProps<typeof CoursewareCompositionGridEditor>)));
}
describe("composition handles share text editor controls", () => {
  it("renders the common corner controls on the exact block bounds and scales the whole overlay", async () => {
    await mount();
    const move = host.querySelector("[data-courseware-node-move-handle]") as HTMLButtonElement;
    const resize = host.querySelector("[data-courseware-node-resize-handle]") as HTMLButtonElement;
    expect(move.style.width).toBe("28px"); expect(move.style.height).toBe("24px");
    expect(resize.style.width).toBe("28px"); expect(resize.style.height).toBe("28px");
    expect(move.textContent).toBe("");
    expect(move.parentElement?.style.outline).toBe("2px solid #e76f78");
    expect(move.parentElement?.className).not.toMatch(/m-1|rounded-xl|border-2/);
    const layer = host.querySelector("[data-courseware-composition-handles]") as HTMLDivElement;
    expect(layer.style.transform).toBe("scale(1)");
    await act(async () => reportWidth(480));
    expect(layer.style.transform).toBe("scale(0.5)");
    expect(host.querySelector("[data-stage-probe]")?.className).toBe("isolate z-0");
  });
  it("shows handles only for selection and preserves keyboard movement", async () => {
    await mount(null);
    expect(host.querySelector("[data-courseware-node-move-handle]")).toBeNull();
    const onChange = vi.fn(); await mount(block.id, onChange);
    const frame = host.querySelector('[role="button"]')!;
    await act(async () => frame.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].layout.blocks[0].placement.column).toBe(block.placement.column + 1);
  });
});
