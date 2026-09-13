// 先用 classroom-mouse-ink-reproduction-20260913.mjs 生成数据，再传入该输出目录。
// 本脚本复用实际 drawItem/InkDraftRenderer，产出 v2/v3 轮廓、窄截面指标与本机计算耗时。
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { textFileSha256 } from "../../../scripts/lib/text-hash.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "package.json")), ts = require("typescript"), modules = new Map();
function source(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const loaded = { exports: {} }; modules.set(file, loaded);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const load = (name) => name.startsWith("@/") ? source(`src/${name.slice(2)}.ts`)
    : name.startsWith(".") ? source(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
  new Function("require", "module", "exports", code)(load, loaded, loaded.exports);
  return loaded.exports;
}
const { drawItem } = source("src/features/whiteboard/strokes.ts");
const { InkDraftRenderer } = source("src/features/whiteboard/ink-draft-renderer.ts");
const { InkPressureCache } = source("src/features/whiteboard/ink-pressure.ts");
const dir = path.resolve(process.argv[2]), data = JSON.parse(readFileSync(path.join(dir, "data.json"), "utf8"));
const w = 345, h = 864, basis = 758;
const round = (n) => +n.toFixed(4);
class RecordedPath {
  commands = [];
  moveTo(...p) { this.commands.push(["M", ...p]); }
  lineTo(...p) { this.commands.push(["L", ...p]); }
  quadraticCurveTo(...p) { this.commands.push(["Q", ...p]); }
  closePath() { this.commands.push(["Z"]); }
}
globalThis.Path2D = RecordedPath;
let filled;
const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, clearRect() {}, fill(p) { filled = p; } };
function item(row, brush) {
  return { id: "synthetic", mode: "ink", color: "ink", brush, wNorm: data.size / basis,
    points: row.points.map(([x, y]) => [(x + 100) / w, y / h]), samples: row.points.map(([, , t]) => [t, null]) };
}
function polygon(commands) {
  const points = [];
  for (const [op, ...p] of commands) {
    if (op === "M" || op === "L") points.push(p);
    else if (op === "Q") {
      const a = points.at(-1), steps = Math.max(4, Math.ceil((Math.hypot(p[0] - a[0], p[1] - a[1]) + Math.hypot(p[2] - p[0], p[3] - p[1])) / 0.15));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, s = 1 - t;
        points.push([s * s * a[0] + 2 * s * t * p[0] + t * t * p[2], s * s * a[1] + 2 * s * t * p[1] + t * t * p[3]]);
      }
    }
  }
  return points;
}
function measure(commands) {
  const poly = polygon(commands), widths = [];
  for (let y = 68.25; y <= 228.25; y++) {
    const xs = [];
    poly.forEach((a, i) => {
      const b = poly[(i + 1) % poly.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
    });
    widths.push(Math.max(...xs) - Math.min(...xs));
  }
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  return { min: round(Math.min(...widths)), max: round(Math.max(...widths)), span: round(Math.max(...widths) - Math.min(...widths)),
    std: round(Math.sqrt(widths.reduce((total, x) => total + (x - mean) ** 2, 0) / widths.length)) };
}
const svgPath = (commands) => commands.map(([op, ...p]) => op + p.map(round).join(" ")).join(" ");
const rows = data.cases.map((row) => {
  const variants = ["freehand-v2", "freehand-v3"].map((brush) => {
    const stroke = item(row, brush);
    drawItem(ctx, stroke, w, h, "#29251f", basis);
    const commands = filled.commands;
    new InkDraftRenderer().render(ctx, [stroke], w, h, basis, () => "#29251f");
    assert.deepEqual(filled.commands, commands, "DRAFT_BASE_MISMATCH");
    return { brush, d: svgPath(commands), metrics: measure(commands) };
  });
  return { id: row.id, label: row.label, variants };
});

// RAF 预览逐帧复算：同一稳定前缀只计算新样本，替换临时尾点后与完整重放一致。
let replayFrames = 0;
for (const row of data.cases) {
  const final = item(row, "freehand-v3"), cache = new InkPressureCache();
  for (const frame of row.frames) {
    const points = final.points.slice(0, frame.count), samples = final.samples.slice(0, frame.count);
    if (frame.tail) { points.push([(frame.tail[0] + 100) / w, frame.tail[1] / h]); samples.push([frame.tail[2], null]); }
    assert.deepEqual(cache.update(points, samples, w, h, data.size), new InkPressureCache().update(points, samples, w, h, data.size));
    replayFrames++;
  }
}

// 仅测 JavaScript 几何/路径调用成本；不包含真实 Path2D、栅格化、输入驱动或显示扫描。
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} closePath() {} };
const timings = {};
for (const brush of ["freehand-v2", "freehand-v3"]) {
  const elapsed = [];
  for (let trial = 0; trial < 6; trial++) {
    const ink = { id: "long", mode: "ink", color: "ink", brush, wNorm: 0.006, points: [], samples: [] };
    const renderer = new InkDraftRenderer();
    for (let i = 0; i < 3000; i++) {
      ink.points.push([0.2 + Math.sin(i / 150) * 0.15, 0.05 + i / 4000]); ink.samples.push([i * 8, null]);
      if (i % 2 === 0) continue;
      const start = performance.now(); renderer.render(ctx, [ink], 1920, 1080, 1920, () => "#222");
      if (trial > 0 && i >= 999) elapsed.push(performance.now() - start);
    }
  }
  elapsed.sort((a, b) => a - b);
  timings[brush] = { medianMs: round(elapsed[Math.floor(elapsed.length * 0.5)]), p95Ms: round(elapsed[Math.floor(elapsed.length * 0.95)]) };
}
const report = { source: "synthetic mouse input, not captured user handwriting", sizeCssPx: data.size, replayFrames,
  measurements: "Interior horizontal sections, y 68.25 to 228.25; curved paths sampled at <= 0.15 px along control polygon",
  cases: rows.map(({ id, label, variants }) => ({ id, label, variants: variants.map(({ brush, metrics }) => ({ brush, ...metrics })) })),
  timings, timingLimit: "Local Node with no-op Path2D; not an end-to-end latency benchmark",
  sources: Object.fromEntries(["src/features/whiteboard/ink-pressure.ts", "src/features/whiteboard/strokes.ts", "src/features/whiteboard/ink-draft-renderer.ts"]
    .map((file) => [file, textFileSha256(path.join(root, file))])) };
writeFileSync(path.join(dir, "v3-report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1050" height="830" viewBox="0 0 1050 830"><rect width="1050" height="830" fill="#fffdf8"/>';
svg += '<style>text{font-family:Arial,"Microsoft YaHei",sans-serif;fill:#29251f}</style><text x="26" y="35" font-size="22">同一组鼠标轨迹 · 实际课堂笔刷</text><text x="26" y="61" font-size="13">左：原 v2　右：新版 v3　｜　模拟输入，原始坐标相同；显示尺度 1:1</text>';
rows.forEach((row, index) => {
  const left = 25 + (index % 3) * 345, top = 95 + Math.floor(index / 3) * 358;
  svg += `<text x="${left}" y="${top}" font-size="15">${row.label}</text>`;
  row.variants.forEach((variant, i) => {
    const x = left + i * 135;
    svg += `<path transform="translate(${x - 35},${top + 18})" d="${variant.d}" fill="#29251f"/>`;
    svg += `<text x="${x + 65}" y="${top + 310}" text-anchor="middle" font-size="13">${i ? "新版 v3" : "原 v2"}</text>`;
    svg += `<text x="${x + 65}" y="${top + 330}" text-anchor="middle" font-size="12">${variant.metrics.min.toFixed(2)}–${variant.metrics.max.toFixed(2)} px</text>`;
  });
});
svg += '<text x="26" y="814" font-size="12">数值为笔画中段的水平截面宽度；减速和左右摆动仍保留，实际书写手感待设备验收。</text></svg>';
writeFileSync(path.join(dir, "v3-comparison.svg"), svg, "utf8");
console.log(JSON.stringify(report, null, 2));
