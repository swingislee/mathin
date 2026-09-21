import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("future spatial workbench integration guard", () => {
  it("routes every workspace using the spatial toolbar through the shared mode/panel state", () => {
    const base = "src/features/tools";
    const files = readdirSync(base, { recursive: true }).filter((name): name is string => typeof name === "string" && /(?:Workspace|Workbench)\.tsx$/.test(name));
    const sources = new Map(files.map((file) => [resolve(base, file), readFileSync(resolve(base, file), "utf8")]));
    // 组合入口把操作交给已接入的子工作台，无需再复制一份模式状态。
    const usesSharedState = (file: string, visited = new Set<string>()): boolean => {
      if (visited.has(file)) return false;
      visited.add(file);
      const source = sources.get(file) ?? "";
      if (source.includes("useSpatialToolState")) return true;
      return [...source.matchAll(/\b(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)].some((match) => {
        if (!match[1].startsWith(".")) return false;
        return usesSharedState(resolve(dirname(file), `${match[1]}.tsx`), visited);
      });
    };
    const workspaces = [...sources].filter(([, source]) => /SpatialActionButton|SpatialIconButton|CubeIconButton/.test(source));
    expect(workspaces.length).toBeGreaterThanOrEqual(8);
    for (const [file, source] of workspaces) {
      expect(usesSharedState(file), `${file}: use the shared state or shared workbench`).toBe(true);
      if (source.includes("useSpatialToolState")) {
        expect(source, `${file}: scope Escape and mode feedback to this workspace`).toContain("controls.bindings");
        expect(source, `${file}: wire blank taps to the shared deselection contract`).toContain("controls.onPointerMissed");
      }
    }
  });
  it("keeps rigid-object handles and support planning on the shared implementation", () => {
    for (const file of ["soma-cube/SomaCanvas.tsx", "spatial-lab/DiceTeachingCanvas.tsx", "spatial-lab/CubeStructuresViewport.tsx", "solid-geometry/SolidGeometryCanvas.tsx"]) {
      const source = readFileSync(resolve("src/features/tools", file), "utf8");
      expect(source).toContain("CubeMoveHandles"); expect(source).toContain("SpatialRotationControls"); expect(source).toContain("SpatialRollControls");
    }
    for (const file of ["soma-cube/model.ts", "spatial-lab/cube-structures-roll.ts", "solid-geometry/solid-geometry-roll.ts"]) {
      expect(readFileSync(resolve("src/features/tools", file), "utf8")).toContain("planSpatialRoll");
    }
    for (const file of ["VoxelCanvas.tsx", "PolyhedronFoldCanvas.tsx"]) {
      expect(readFileSync(resolve("src/features/spatial-math/renderer-r3f", file), "utf8")).toContain("onPointerMissed={");
    }
  });
  it("hides only the passive workspace focus outline, preserving control focus styles", () => {
    const css = readFileSync("src/features/tools/spatial-lab/CubeStructuresWorkbench.module.css", "utf8");
    expect(css).toMatch(/\.workspace:focus\s*\{[^}]*outline:\s*none/);
    expect(css).not.toMatch(/\.workspace\s+[^{}]*:focus[^{}]*\{[^}]*outline:\s*none/);
  });
});
