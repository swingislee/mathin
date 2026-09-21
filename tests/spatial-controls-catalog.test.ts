import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpatialActionButton } from "@/features/tools/spatial-interaction/SpatialActionButton";
import { SpatialActionIcon } from "@/features/tools/spatial-interaction/SpatialActionIcon";
import { SPATIAL_ACTIONS, type SpatialActionId } from "@/features/tools/spatial-interaction/actions";
import { SPATIAL_WORKBENCH_INVENTORY } from "@/features/tools/spatial-interaction/control-inventory";
import { renderSpatialControlsCatalog } from "../scripts/spatial-controls-catalog-render";

const source = (file: string) => readFileSync(`src/features/tools/${file}`, "utf8");
const keys = Object.keys(SPATIAL_ACTIONS) as SpatialActionId[];
function usedActions(text: string): SpatialActionId[] {
  const values = [...text.matchAll(/\baction\s*(?:=|:)\s*(?:"([^"]+)"|\{([^}]+)\})/g)].flatMap((m) => m[1] ? [m[1]] : [...m[2].matchAll(/"([^"]+)"/g)].map((part) => part[1]));
  return keys.filter((key) => values.includes(key));
}

describe("shared spatial controls catalog", () => {
  it("renders every action through the same accessible button and real SVG", () => {
    for (const action of keys) {
      const meta = SPATIAL_ACTIONS[action]; expect(meta.zh).toBeTruthy(); expect(meta.en).toBeTruthy();
      const html = renderToStaticMarkup(createElement(SpatialActionButton, { action, label: meta.zh, active: true, disabled: true }));
      expect(html).toContain(`data-spatial-action="${action}"`); expect(html).toContain(`data-spatial-icon="${action}"`);
      expect(html).toContain('aria-pressed="true"'); expect(html).toContain('disabled=""'); expect(html).toContain('aria-hidden="true"');
    }
  });
  it("distinguishes the major teaching actions that previously shared a misleading icon", () => {
    for (const [a, b] of [["move", "faceReveal"], ["pan", "move"], ["orbit", "rotate"], ["unfold", "reset"], ["opacity", "liquid"], ["section", "cut"], ["assemble", "separate"], ["netGallery", "contact"], ["cameraSnap", "moveSnap"]] as const) {
      expect(SPATIAL_ACTIONS[a].icon).not.toBe(SPATIAL_ACTIONS[b].icon);
      const shape = (action: SpatialActionId) => renderToStaticMarkup(createElement(SpatialActionIcon, { action })).replace(/data-spatial-icon="[^"]+"/g, "");
      expect(shape(a)).not.toBe(shape(b));
    }
    expect(source("spatial-lab/DiceTeachingWorkspace.tsx")).toContain('action="faceReveal" label={m.arrows}');
    expect(source("spatial-lab/CubeNetFoldWorkspace.tsx")).toContain('action="faceReveal"');
    expect(source("spatial-lab/CubeStructuresWorkbench.tsx")).toContain('action={hidden ? "show" : "hide"}');
  });
  it("keeps current and future shared workspaces on semantic controls, without local SVG choices", () => {
    const root = "src/features/tools";
    const files = readdirSync(root, { recursive: true }).filter((file): file is string => typeof file === "string" && /(?:Workspace|Workbench)\.tsx$/.test(file));
    const workspaces = files.map((file) => [file, source(file)]).filter(([, text]) => text.includes("useSpatialToolState"));
    expect(workspaces.length).toBeGreaterThanOrEqual(8);
    for (const [file, text] of workspaces) {
      expect(text, file).toContain("SpatialActionButton"); expect(text, file).toContain("SpatialViewButtons");
      expect(text, file).not.toContain('from "lucide-react"'); expect(text, file).not.toContain("<svg");
      expect(text, file).not.toContain("CubeWorkbenchControls");
    }
    for (const file of ["soma-cube/SomaWorkspace.tsx", "spatial-lab/CubeStructuresWorkbench.tsx", "spatial-lab/DiceTeachingWorkspace.tsx", "solid-geometry/SolidGeometryWorkspace.tsx"]) expect(source(file)).toContain("SpatialAxisSteps");
  });
  it("builds the side-by-side comparison from the same components and source bindings", () => {
    const usages = Object.fromEntries(SPATIAL_WORKBENCH_INVENTORY.map((stage) => [stage.id, usedActions(stage.files.map(source).join("\n"))]));
    const html = renderSpatialControlsCatalog(usages);
    expect(SPATIAL_WORKBENCH_INVENTORY).toHaveLength(10); expect(html).toContain("<svg");
    for (const action of keys) expect(html).toContain(`data-spatial-icon="${action}"`);
    expect(usages.dice).toContain("faceReveal"); expect(usages["cube-structures"]).toContain("move");
    if (process.env.MATHIN_WRITE_SPATIAL_CATALOG === "1") {
      const output = resolve(".tmp/spatial-controls-comparison.html"); mkdirSync(resolve(".tmp"), { recursive: true }); writeFileSync(output, html, "utf8");
      console.log(`Spatial controls comparison: ${output}`);
    }
  });
});
