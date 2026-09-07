import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VoxelRendererMessages } from "@/features/spatial-math/renderer-r3f/VoxelFallback";
import { CubeStructuresWorkbench } from "@/features/tools/spatial-lab/CubeStructuresWorkbench";
import { createCubeSession } from "@/features/tools/spatial-lab/cube-structures-session";
import { CUBE_TOOLBAR_IDS, type CubeToolbarId } from "@/features/tools/spatial-lab/cube-structures-toolbar";

vi.mock("next/dynamic", () => ({ default: () => () => null }));

function render(toolbar: readonly CubeToolbarId[], readOnly = false) {
  return renderToStaticMarkup(createElement(CubeStructuresWorkbench, {
    locale: "en", rendererMessages: {} as VoxelRendererMessages,
    cameraMessages: { axisSnap: "Snap", enableAxisSnap: "Enable snap", disableAxisSnap: "Disable snap" },
    courseware: { initial: createCubeSession([{ x: 0, y: 0, z: 0 }]), toolbar, readOnly, resetLabel: "Restore starting scene", resetHint: "Restore this fixed copy" },
  }));
}

describe("embedded cube toolbar rendering", () => {
  it("renders exactly the selected primary tools and view controls", () => {
    const html = render(["cut", "orbit", "view-left"]);
    expect([...html.matchAll(/data-cube-tool="([^"]+)"/g)].map((match) => match[1])).toEqual(["orbit", "cut"]);
    expect(html).toContain('aria-label="Left"');
    expect(html).not.toContain('aria-label="Top"');
    expect(html).not.toContain('aria-label="Restore starting scene"');
    expect(html).not.toContain('data-cube-draft-panel');
  });
  it("renders a model-only component for an empty subset", () => {
    const html = render([]);
    expect(html).not.toContain('role="toolbar"');
    expect(html).not.toContain('data-cube-tool=');
  });
  it("keeps all selected buttons visible but the classroom instance inert", () => {
    const html = render(CUBE_TOOLBAR_IDS, true);
    expect(html).toContain('inert=""');
    expect([...html.matchAll(/data-cube-tool="/g)]).toHaveLength(13);
    expect(html).toContain('aria-label="Restore starting scene"');
    expect(html).toContain('aria-label="Enable snap"');
  });
});
