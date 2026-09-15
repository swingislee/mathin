import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { THREE_SHADOWS } from "@/lib/three-runtime";

const require = createRequire(import.meta.url);
const deprecatedExports = new Set(["Clock", "PCFSoftShadowMap"]);

/** 扫描当前交付源码与脚本；库源码、历史说明和负例测试不作为业务调用点。 */
function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : /\.(?:[cm]?js|jsx|tsx?|html)$/.test(path) && !path.endsWith(".d.ts") ? [path] : [];
  });
}
function inspect(file: string, text: string) {
  const problems: string[] = [], canvases: { file: string; shadows: string; frameloop: string }[] = [];
  const namespaces = new Set(["THREE"]), canvasNames = new Set<string>();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const location = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const from = node.moduleSpecifier.text, bindings = node.importClause?.namedBindings;
    if (/^three(?:\/|$)/.test(from)) {
      if (/\/Clock(?:\.js)?$/.test(from)) problems.push(`${location(node)}: 直接引入已弃用 Clock 模块`);
      if (node.importClause?.name) namespaces.add(node.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        const original = (item.propertyName ?? item.name).text;
        if (deprecatedExports.has(original)) problems.push(`${location(item)}: 使用受支持的 Timer / PCFShadowMap 替代 ${original}`);
      }
    }
    if (from === "@react-three/fiber" && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) if ((item.propertyName ?? item.name).text === "Canvas") canvasNames.add(item.name.text);
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && namespaces.has(node.expression.getText(source)) && deprecatedExports.has(node.name.text)) {
      problems.push(`${location(node)}: 直接使用已弃用的 ${node.name.text}`);
    }
    if (ts.isElementAccessExpression(node) && namespaces.has(node.expression.getText(source)) && ts.isStringLiteral(node.argumentExpression) && deprecatedExports.has(node.argumentExpression.text)) {
      problems.push(`${location(node)}: 索引使用已弃用的 ${node.argumentExpression.text}`);
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && canvasNames.has(node.tagName.getText(source))) {
      const attribute = (name: string) => node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === name) as ts.JsxAttribute | undefined;
      const shadows = attribute("shadows")?.initializer?.getText(source) ?? "";
      if (!/^\{THREE_SHADOWS\.(disabled|filtered)\}$/.test(shadows)) problems.push(`${location(node)}: Canvas 使用全仓 THREE_SHADOWS 明确配置`);
      canvases.push({ file: file.replaceAll("\\", "/"), shadows, frameloop: attribute("frameloop")?.initializer?.getText(source) ?? '"always"' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { problems, canvases };
}

describe("repository-wide Three compatibility", () => {
  it("covers every authored runtime file and every Canvas root", () => {
    const results = ["src", "scripts", "public"].flatMap(filesIn).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      if (file.endsWith(".html")) return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => inspect(file, match[1]));
      return [inspect(file, text)];
    });
    expect(results.flatMap((result) => result.problems)).toEqual([]);
    const actual = results.flatMap((result) => result.canvases).sort((a, b) => a.file.localeCompare(b.file));
    const expected = [
      ["src/features/terms/three/galaxy-scene.tsx", "disabled", "always"],
      ["src/features/terms/three/planet-scene.tsx", "disabled", "always"],
      ["src/features/spatial-math/renderer-r3f/VoxelCanvas.tsx", "disabled", "demand"],
      ["src/features/spatial-math/renderer-r3f/PolyhedronFoldCanvas.tsx", "disabled", "demand"],
      ["src/features/tools/spatial-lab/DiceTeachingCanvas.tsx", "filtered", "demand"],
    ].map(([file, shadows, mode]) => ({ file, shadows: `{THREE_SHADOWS.${shadows}}`, frameloop: `"${mode}"` })).sort((a, b) => a.file.localeCompare(b.file));
    expect(actual).toEqual(expected);
    expect(THREE_SHADOWS).toEqual({ disabled: false, filtered: "percentage" });
  });

  it.each([
    'import { Clock as SceneTime } from "three"; new SceneTime();',
    'import * as Engine from "three"; new Engine.Clock();',
    'import * as Engine from "three"; const mode = Engine["PCFSoftShadowMap"];',
    'import { PCFSoftShadowMap } from "three";',
    'import { Canvas as Stage } from "@react-three/fiber"; <Stage shadows />;',
  ])("rejects deprecated or implicit configuration: %s", (source) => {
    expect(inspect("fixture.tsx", source).problems.length).toBeGreaterThan(0);
  });

  it("keeps non-Three Clock icons and native Timer usage valid", () => {
    expect(inspect("fixture.tsx", 'import { Clock } from "lucide-react"; import { Timer } from "three"; new Timer(); <Clock />;').problems).toEqual([]);
  });

  it("pins the compatible runtime/type versions and shares one renderer dependency graph", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    for (const [name, version] of Object.entries({ three: "0.185.1", "@react-three/fiber": "9.6.1", "@react-three/drei": "10.7.7", "@types/three": "0.185.0" })) {
      expect({ ...manifest.dependencies, ...manifest.devDependencies }[name]).toBe(version);
    }
    const fromDrei = createRequire(require.resolve("@react-three/drei/package.json"));
    const fromFiber = createRequire(require.resolve("@react-three/fiber/package.json"));
    const fromStdlib = createRequire(fromDrei.resolve("three-stdlib"));
    expect(realpathSync(fromDrei.resolve("@react-three/fiber"))).toBe(realpathSync(require.resolve("@react-three/fiber")));
    for (const resolve of [fromDrei, fromFiber, fromStdlib]) expect(realpathSync(resolve.resolve("three"))).toBe(realpathSync(require.resolve("three")));
  });
});
