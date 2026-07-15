#!/usr/bin/env node
// 每路由客户端 JS 体积报表（P4G-7 §6.1「先量后改」的量尺）。
//
// Turbopack 的 `next build` 不再打印体积列，所以这里直接读构建产物：
//   - .next/server/app/**/page/build-manifest.json  → 该路由的共享壳（rootMainFiles + polyfill）
//   - .next/server/app/**/page_client-reference-manifest.js → 该路由引用的客户端模块所在 chunk
// 两者并集去重后按 gzip 尺寸求和，即用户打开该路由要下载的首屏 JS。
//
// 用法：pnpm build && pnpm bundle:report [--json] [--baseline <file>]
// 加 --baseline 会与既有报表对比，打印每路由增减（回归用）。

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const APP_DIR = ".next/server/app";
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const baselinePath = args[args.indexOf("--baseline") + 1];
const baseline = args.includes("--baseline") && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;

if (!existsSync(APP_DIR)) {
  console.error("找不到 .next/server/app —— 先跑 pnpm build");
  process.exit(1);
}

const gzipCache = new Map();
function gzipSize(chunk) {
  if (gzipCache.has(chunk)) return gzipCache.get(chunk);
  const file = join(".next", chunk.replace(/^static\//, "static/"));
  const size = existsSync(file) ? gzipSync(readFileSync(file)).length : 0;
  gzipCache.set(chunk, size);
  return size;
}

/** 递归找出所有 page 路由目录（含 page.js 的目录）。 */
function findPages(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, "page.js"))) out.push(full);
    findPages(full, out);
  }
  return out;
}

function chunksOf(pageDir) {
  const chunks = new Set();

  const manifest = join(pageDir, "page", "build-manifest.json");
  if (existsSync(manifest)) {
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    for (const f of [...(m.rootMainFiles ?? []), ...(m.polyfillFiles ?? [])]) chunks.add(f);
  }

  // client-reference-manifest 是一段赋值给 globalThis 的 JS，正则抽 chunk 路径比 eval 安全。
  const clientRef = join(pageDir, "page_client-reference-manifest.js");
  if (existsSync(clientRef)) {
    const text = readFileSync(clientRef, "utf8");
    for (const [chunk] of text.matchAll(/static\/chunks\/[\w.-]+\.js/g)) chunks.add(chunk);
  }

  return [...chunks];
}

const rows = findPages(APP_DIR)
  .map((pageDir) => {
    const chunks = chunksOf(pageDir);
    const route = "/" + relative(APP_DIR, pageDir).replaceAll("\\", "/");
    return { route, chunks: chunks.length, gzip: chunks.reduce((sum, c) => sum + gzipSize(c), 0) };
  })
  .sort((a, b) => b.gzip - a.gzip);

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const prev = new Map((baseline ?? []).map((r) => [r.route, r.gzip]));

console.log("路由客户端 JS（gzip，含共享壳）\n");
for (const row of rows) {
  const before = prev.get(row.route);
  const delta = before === undefined ? "" : before === row.gzip ? "  =" : `  ${row.gzip > before ? "+" : ""}${kb(row.gzip - before)}`;
  console.log(`${kb(row.gzip).padStart(9)}  ${row.route}${delta}`);
}

const shell = rows.length ? Math.min(...rows.map((r) => r.gzip)) : 0;
console.log(`\n路由数 ${rows.length}；最小路由（≈共享壳下限）${kb(shell)}；最大 ${kb(rows[0]?.gzip ?? 0)}`);
