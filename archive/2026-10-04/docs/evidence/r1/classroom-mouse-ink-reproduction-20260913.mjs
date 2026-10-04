// 鼠标书写复算：调用当前输入筛选与 PF，生成合成轨迹证据；不连接业务服务。
// node docs/evidence/r1/classroom-mouse-ink-reproduction-20260913.mjs <输出目录>
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { textFileSha256 } from "../../../scripts/lib/text-hash.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const { getStroke, getStrokePoints } = require("perfect-freehand");
const modules = new Map();
function loadSource(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const loaded = { exports: {} };
  modules.set(file, loaded);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sourceRequire = (name) => name.startsWith("@/") ? loadSource(`src/${name.slice(2)}.ts`)
    : name.startsWith(".") ? loadSource(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
  new Function("require", "module", "exports", code)(sourceRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { BoardInputSink } = loadSource("src/features/whiteboard/board-input-sink.ts");
const { appendStrokeInput, pointerInkMetadata, previewStroke, strokeSample } = loadSource("src/features/whiteboard/ink-input.ts");
const { classroomPressureOutline } = loadSource("src/features/whiteboard/strokes.ts");

const size = 758 * 0.006; // 已观察主板书宽约 758 CSS px；采用仓库默认中号，不声称现场所选字号。
const dimensions = { w: 345, h: 864 };
const options = { size, thinning: 0.7, streamline: 0.1, smoothing: 0.6, simulatePressure: true, last: true };
const round = (n, precision = 4) => +n.toFixed(precision);
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];

// 相同时间连续曲线；事件采样与 RAF 合批在后面独立控制。
function position(t, duration, config, phase = 0) {
  const u = t / duration;
  const progress = config.decelerate ? (0.76 * (1 - Math.exp(-4.5 * u)) / (1 - Math.exp(-4.5)) + 0.24 * u) : u;
  const y = 18 + 250 * progress;
  const envelope = Math.min(1, u * 8);
  const x = config.sway ? envelope * (1.8 * Math.sin(t / 190 + phase)
    + 0.65 * Math.sin(t / 39 + phase) + 0.2 * Math.sin(t / 13)) : 0;
  const grid = config.quantize ? 1 : 0;
  return [grid ? Math.round(x / grid) * grid : x, grid ? Math.round(y / grid) * grid : y];
}
function sample(config, phase = 0) {
  const duration = config.decelerate ? 1800 : 1500;
  const points = [];
  for (let t = 0; ; ) {
    const [x, y] = position(t, duration, config, phase);
    points.push([x, y, t]);
    if (t === duration) break;
    const step = config.cadence ? (Math.floor((t + phase * 60) / 100) % 2 ? 16 : 4) : 8;
    t = Math.min(duration, t + step);
  }
  return points;
}

function runInput(raw, { rafHz = 60, groupSize = 1, minDistancePx = 0.75 } = {}) {
  let now = 0, handle = 0, preview = null;
  const frameMs = 1000 / rafHz, callbacks = new Map(), frames = [];
  const input = ([x, y, t], buttons = 1) => [x, y,
    pointerInkMetadata({ pointerType: "mouse", pressure: buttons ? 0.5 : 0, timeStamp: t, buttons })];
  const norm = ([x, y, metadata]) => [x / dimensions.w, y / dimensions.h, metadata];
  const first = input(raw[0]);
  const stroke = { id: "synthetic-mouse", mode: "ink", color: "ink", brush: "freehand-v2", wNorm: size / 758,
    points: [norm(first).slice(0, 2)], samples: [strokeSample(first, 0)] };
  const convert = (item) => item.points.map(([x, y], i) => [x * dimensions.w, y * dimensions.h, item.samples[i][0]]);
  const capture = () => frames.push({ t: now, points: convert(previewStroke(stroke, preview, 0)) });
  const sink = new BoardInputSink((points) => { appendStrokeInput(stroke, points.map(norm), 0); capture(); }, {
    minDistancePx,
    onPreview(point) { preview = point ? norm(point) : null; },
    scheduler: {
      request(callback) { const id = ++handle; callbacks.set(id, { time: (Math.floor(now / frameMs) + 1) * frameMs, callback }); return id; },
      cancel(id) { callbacks.delete(id); },
    },
  });
  function advance(to) {
    for (;;) {
      const next = [...callbacks].sort((a, b) => a[1].time - b[1].time)[0];
      if (!next || next[1].time >= to - 1e-7) break;
      callbacks.delete(next[0]); now = next[1].time; next[1].callback(now);
    }
    now = to;
  }
  sink.begin(1, first); capture();
  for (let i = 1; i < raw.length; i += groupSize) {
    const batch = raw.slice(i, i + groupSize);
    advance(batch.at(-1)[2]);
    sink.push(1, batch.map((point) => input(point)));
  }
  advance(raw.at(-1)[2]);
  sink.finish(1, [input(raw.at(-1), 0)]); capture();
  assert(stroke.samples.every(([, pressure]) => pressure === null));
  return { points: convert(stroke), frames, stroke };
}

// 因果对照用的压力估计，仅存在于本复算文件。保持坐标不变，用 dt 平滑速度与压力。
function timedPressure(points) {
  let pressure = 0.5, speed = null;
  return points.map(([x, y, t], i) => {
    if (i > 0) {
      const [px, py, pt] = points[i - 1];
      const dt = t - pt;
      if (dt > 0) {
        const nextSpeed = Math.hypot(x - px, y - py) / dt;
        speed = speed === null ? nextSpeed : speed + (nextSpeed - speed) * (1 - Math.exp(-dt / 24));
        const target = Math.max(0.05, Math.min(0.95, 1 - speed * 8 / size));
        pressure += (target - pressure) * (1 - Math.exp(-dt / 28));
      }
    }
    return [x, y, pressure];
  });
}
function outline(points, variant = "current") {
  if (variant === "current") return classroomPressureOutline(points.map(([x, y]) => [x, y]), points.map(([, , t]) => [t, null]), size);
  const input = variant === "timed" ? timedPressure(points) : points.map(([x, y]) => [x, y]);
  const coordinates = input.length === 1 ? [input[0], input[0]] : input;
  return getStroke(coordinates, { ...options, ...(variant === "thin" ? { thinning: 0.5 } : {}),
    ...(variant === "stream" ? { streamline: 0.5 } : {}), ...(variant === "smooth" ? { smoothing: 0.9 } : {}),
    ...(variant === "timed" ? { simulatePressure: false } : {}), ...(variant === "fixed" ? { thinning: 0 } : {}) });
}
function curvePoints(points) {
  const result = [], middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let i = 0; i < points.length; i++) {
    const a = middle(points[(i + points.length - 1) % points.length], points[i]);
    const b = points[i], c = middle(b, points[(i + 1) % points.length]);
    const steps = Math.max(3, Math.ceil((Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1])) / 0.15));
    for (let step = 0; step < steps; step++) {
      const t = step / steps, s = 1 - t;
      result.push([s * s * a[0] + 2 * s * t * b[0] + t * t * c[0], s * s * a[1] + 2 * s * t * b[1] + t * t * c[1]]);
    }
  }
  return result;
}
function sections(poly) {
  const rows = [];
  for (let y = 68.25; y <= 228.25; y++) {
    const hits = [];
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) hits.push(ax + (bx - ax) * (y - ay) / (by - ay));
    }
    if (hits.length >= 2) rows.push({ y, width: Math.max(...hits) - Math.min(...hits), center: (Math.max(...hits) + Math.min(...hits)) / 2 });
  }
  return rows;
}
function stats(poly) {
  const rows = sections(poly), widths = rows.map((row) => row.width), mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  const secondDifferences = rows.slice(1, -1).map((row, i) => Math.abs(rows[i + 2].width - 2 * row.width + rows[i].width));
  return { min: round(Math.min(...widths)), max: round(Math.max(...widths)), p10: round(quantile(widths, 0.1)), p90: round(quantile(widths, 0.9)),
    mean: round(mean), std: round(Math.sqrt(widths.reduce((sum, width) => sum + (width - mean) ** 2, 0) / widths.length)),
    widthBendP90: round(quantile(secondDifferences, 0.9)) };
}
const cases = [
  { id: "uniform", label: "匀速 · 每 8 ms 采样", config: {} },
  { id: "cadence", label: "匀速 · 4 / 16 ms 间隔交替", config: { cadence: true } },
  { id: "pixels", label: "匀速 · 鼠标坐标取整", config: { quantize: true } },
  { id: "slowing", label: "逐渐减速 · 每 8 ms 采样", config: { decelerate: true } },
  { id: "sway", label: "匀速向下 · 小幅左右微摆", config: { sway: true } },
  { id: "combined", label: "仿截图 · 减速、微摆与间隔变化", config: { decelerate: true, sway: true, cadence: true, quantize: true } },
];
const variants = ["current", "thin", "stream", "smooth", "timed", "fixed"];
const simulations = cases.map(({ id, label, config }) => {
  const raw = sample(config), result = runInput(raw);
  const rows = Object.fromEntries(variants.map((variant) => [variant, stats(outline(result.points, variant))]));
  rows.curve = stats(curvePoints(outline(result.points)));
  const rawSpacing = raw.slice(1).map(([x, y], i) => Math.hypot(x - raw[i][0], y - raw[i][1]));
  return { id, label, config, raw, points: result.points, frames: result.frames, stroke: result.stroke,
    metrics: { samples: raw.length, accepted: result.points.length, spacingP10: round(quantile(rawSpacing, 0.1)), spacingP90: round(quantile(rawSpacing, 0.9)), variants: rows } };
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cadence = simulations.find((row) => row.id === "cadence");
const grouped = runInput(cadence.raw, { groupSize: 4 });
const slowRaf = runInput(cadence.raw, { rafHz: 30 });
const timeStretched = cadence.points.map(([x, y, t]) => [x, y, t * 3]);
const checks = {
  mouseSamplesHaveNoRealPressure: simulations.every((sim) => sim.stroke.samples.every(([, pressure]) => pressure === null)),
  timesThreeSameCurrentOutline: same(outline(cadence.points), outline(timeStretched)),
  groupedSamplesSameFinalPoints: same(cadence.points, grouped.points),
  raf30SameFinalPoints: same(cadence.points, slowRaf.points),
  timedVariantChangesWhenTimeChanges: !same(outline(cadence.points, "timed"), outline(timeStretched, "timed")),
};
for (const [name, passed] of Object.entries(checks)) assert(passed, name);
const spatialJitter = simulations.find((row) => row.id === "sway");
const lateral = (streamline) => {
  const points = getStrokePoints(spatialJitter.points.map(([x, y]) => [x, y]), { ...options, streamline });
  return round(Math.sqrt(points.filter(({ point }) => point[1] > 68 && point[1] < 228)
    .reduce((sum, { point }) => sum + point[0] ** 2, 0) / points.filter(({ point }) => point[1] > 68 && point[1] < 228).length));
};
const pfFile = path.join(root, "node_modules/perfect-freehand/dist/esm/index.mjs");
const pfSource = readFileSync(pfFile, "utf8");
const pfVersion = JSON.parse(readFileSync(path.join(root, "node_modules/perfect-freehand/package.json"), "utf8")).version;
const report = { source: "synthetic mouse trajectories; not captured from the user's page", pfVersion, sizeCssPx: size,
  geometryUnits: "CSS px; y=68.25..228.25 interior horizontal cross-sections, excluding caps", checks,
  lateralRms: { streamline01: lateral(0.1), streamline05: lateral(0.5) },
  sourceSha256: textFileSha256(pfFile),
  cases: simulations.map(({ id, label, metrics }) => ({ id, label, ...metrics })) };
console.log(JSON.stringify(report, null, 2));

if (process.argv[2]) {
  const output = path.resolve(process.argv[2]); mkdirSync(output, { recursive: true });
  writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  // 回放保存筛选后的稳定点，以及每帧最新预览末点；不存每帧重复的完整点列。
  const data = simulations.map(({ id, label, raw, points, frames, metrics }) => ({ id, label, duration: raw.at(-1)[2],
    points: points.map((p) => p.map((v) => round(v))),
    frames: frames.map(({ t, points: framePoints }) => {
      const stableCount = framePoints.findLastIndex((p, i) => i < points.length && same(p, points[i])) + 1;
      const tail = framePoints.length > stableCount ? framePoints.at(-1).map((v) => round(v)) : null;
      const replay = points.slice(0, stableCount).map((p) => p.map((v) => round(v)));
      if (tail) replay.push(tail);
      assert(same(replay, framePoints.map((p) => p.map((v) => round(v)))), "REPLAY_PREFIX_CHANGED");
      return { t: round(t), count: stableCount, tail };
    }), metrics }));
  writeFileSync(path.join(output, "data.json"), JSON.stringify({ size, options, cases: data }), "utf8");
  const exportsStart = pfSource.lastIndexOf("export{");
  assert(exportsStart >= 0, "PF_ESM_EXPORT_FORMAT_CHANGED");
  const strokeExport = pfSource.slice(exportsStart).match(/([\w$]+) as getStroke[,}]/)?.[1];
  const pointsExport = pfSource.slice(exportsStart).match(/([\w$]+) as getStrokePoints[,}]/)?.[1];
  assert(strokeExport && pointsExport, "PF_ESM_EXPORT_NAMES_CHANGED");
  // 原包的 MIT 实现，用 IIFE 避免与交互脚本的局部名称冲突。
  const license = readFileSync(path.join(root, "node_modules/perfect-freehand/LICENSE"), "utf8");
  const pfBrowser = `/* perfect-freehand ${pfVersion}\n${license}\n*/\n(function(){${pfSource.slice(0, exportsStart)}return {getStroke:${strokeExport},getStrokePoints:${pointsExport}};})()`;
  writeFileSync(path.join(output, "pf-browser.js"), pfBrowser, "utf8");
  writeFileSync(path.join(output, "timed-pressure.js"), timedPressure.toString(), "utf8");
  // 生成独立静态复算图；与浏览器 Canvas 无关，用于检查轮廓几何是否已经含有起伏。
  const columns = ["current", "thin", "stream", "smooth", "curve", "timed"];
  const titles = ["Current", "Thinning 0.5", "Streamline 0.5", "Smoothing 0.9", "Quadratic edges", "Timed pressure"];
  const svgPath = (poly) => poly.map(([x, y], i) => `${i ? "L" : "M"}${round(x, 3)},${round(y, 3)}`).join(" ") + "Z";
  const rows = ["uniform", "cadence", "combined"];
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1140" height="1150" viewBox="0 0 1140 1150"><rect width="1140" height="1150" fill="#fff"/>';
  columns.forEach((_, i) => { svg += `<text x="${100 + i * 182}" y="34" text-anchor="middle" font-family="sans-serif" font-size="15">${titles[i]}</text>`; });
  rows.forEach((id, ri) => {
    const sim = simulations.find((row) => row.id === id), top = 75 + ri * 353;
    svg += `<text x="16" y="${top}" font-family="sans-serif" font-size="16">${id}</text>`;
    columns.forEach((variant, ci) => {
      const poly = variant === "curve" ? curvePoints(outline(sim.points)) : outline(sim.points, variant);
      svg += `<path transform="translate(${100 + ci * 182},${top + 12})" d="${svgPath(poly)}" fill="#222"/>`;
      const m = sim.metrics.variants[variant];
      svg += `<text x="${100 + ci * 182}" y="${top + 305}" text-anchor="middle" font-family="sans-serif" font-size="13">${m.min.toFixed(2)}–${m.max.toFixed(2)} px</text>`;
    });
  });
  svg += '<text x="16" y="1132" font-family="sans-serif" font-size="14">Synthetic trajectories · PF 1.2.3 · base size 4.548 CSS px · measured interior cross-sections</text></svg>';
  writeFileSync(path.join(output, "comparison.svg"), svg, "utf8");
}
