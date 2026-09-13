// 源码复查的合成输入复算；只读本地源码，不访问浏览器、数据库或网络。
// 这些输出用于记录 a31de69e 的行为；相关实现修正后，输出应随之变化。
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const cache = new Map();

function loadSource(relativePath) {
  const file = path.resolve(root, relativePath);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const sourceRequire = (name) => {
    if (name.startsWith("@/")) return loadSource(`src/${name.slice(2)}.ts`);
    if (name.startsWith(".")) return loadSource(path.resolve(path.dirname(file), `${name}.ts`));
    return require(name);
  };
  new Function("require", "module", "exports", code)(sourceRequire, module, module.exports);
  return module.exports;
}

const { BoardInputSink } = loadSource("src/features/whiteboard/board-input-sink.ts");
const { classroomInkOutline } = loadSource("src/features/whiteboard/strokes.ts");
const { buildBoardCheckpoint, utf8JsonBytes } = loadSource("src/features/classroom/checkpoint/codec.ts");
const { flattenCheckpointChunks } = loadSource("src/features/classroom/checkpoint/parse.ts");
const { getStrokePoints } = require("perfect-freehand");
const report = (value) => console.log(JSON.stringify(value));

function inputHarness() {
  let id = 0;
  const frames = new Map();
  const batches = [];
  const sink = new BoardInputSink((points) => batches.push(points.map((point) => [...point])), {
    scheduler: {
      request(callback) { frames.set(++id, callback); return id; },
      cancel(handle) { frames.delete(handle); },
    },
  });
  const frame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  };
  return { sink, frames, batches, frame };
}

function widthAt(outline, x) {
  const ys = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    if ((a[0] <= x && b[0] > x) || (b[0] <= x && a[0] > x)) {
      ys.push(a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]));
    }
  }
  if (ys.length < 2) throw new Error("SYNTHETIC_OUTLINE_CROSS_SECTION_MISSING");
  return Math.max(...ys) - Math.min(...ys);
}

const short = inputHarness();
short.sink.begin(1, [0, 0]);
short.sink.push(1, [[0.4, 0]]);
short.frame();
report({ case: "subthreshold_after_frame", batches: short.batches, scheduledFrames: short.frames.size });
short.sink.finish(1);
report({ case: "subthreshold_after_finish", batches: short.batches });

const tail = inputHarness();
tail.sink.begin(2, [0, 0]);
tail.sink.push(2, [[10, 0], [10.5, 0]]);
tail.frame();
report({ case: "newest_tail_after_frame", displayed: tail.batches.at(-1).at(-1), newest: [10.5, 0], scheduledFrames: tail.frames.size });

// 同一条 600 CSS px、历时 1 秒的直线，仅改变输入采样数量；不是设备采样率实测。
for (const sampleHz of [60, 120, 240]) {
  const points = Array.from({ length: sampleHz + 1 }, (_, i) => [i * 600 / sampleHz, 100]);
  const width = widthAt(classroomInkOutline(points, 12), 300);
  report({ case: "same_600_css_px_per_second", sampleHz, inputPoints: points.length, widthAt300: +width.toFixed(4) });
}

report({
  case: "streamline_half_with_last_true",
  samples: [2, 10, 20].map((step) => {
    const points = Array.from({ length: 40 }, (_, i) => [i * step, 100]);
    const center = getStrokePoints(points, { size: 12, streamline: 0.5, last: true }).at(-1).point[0];
    return { step, centerlineGap: points.at(-1)[0] - center };
  }),
});

const ink = {
  id: "synthetic-width-review", brush: "freehand-v1", mode: "ink", color: "blue", wNorm: 12 / 3840,
  points: Array.from({ length: 4000 }, (_, i) => [0.1051234567891011 + 0.8 * i / 3999, 0.023456789123456789]),
};
const prepared = buildBoardCheckpoint([ink]);
const restored = flattenCheckpointChunks(prepared.chunks, 1)[0];
const savedWidth = (item) => widthAt(classroomInkOutline(item.points.map(([x, y]) => [x * 3840, y * 2160]), 12), 1800);
report({ case: "checkpoint_width_after_size_limit", inputBytes: utf8JsonBytes([ink]), storedBytes: prepared.contentBytes,
  pointsBefore: ink.points.length, pointsAfter: restored.points.length, resampled: prepared.resampled,
  stepCssPx: 3840 * 0.8 / 3999, widthBefore: savedWidth(ink), widthAfter: savedWidth(restored) });

const long = { ...ink, id: "synthetic-long-review", points: Array.from({ length: 4001 }, (_, i) => [i % 2 ? 0.11 : 0.1, 0.2]) };
const longPrepared = buildBoardCheckpoint([long]);
let reader = "ok";
try { flattenCheckpointChunks(longPrepared.chunks, 1); } catch (error) { reader = error.message; }
report({ case: "long_stroke_writer_reader_contract", inputPoints: long.points.length,
  storedPoints: longPrepared.storedPointCount, storedBytes: longPrepared.contentBytes, reader });
