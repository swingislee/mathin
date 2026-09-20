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
    const workspaces = [...sources].filter(([, source]) => source.includes("CubeIconButton"));
    expect(workspaces.length).toBeGreaterThanOrEqual(8);
    for (const [file, source] of workspaces) {
      expect(usesSharedState(file), `${file}: use the shared state or shared workbench`).toBe(true);
      if (source.includes("useSpatialToolState")) expect(source, `${file}: scope Escape and mode feedback to this workspace`).toContain("controls.bindings");
    }
  });
});
