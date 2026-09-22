#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { forbiddenTrackedPath, scanBytes } from "./check-repository-secrets.mjs";

const MAX_HISTORY_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;

function git(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    shell: false,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    const error = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(error || `git ${args[0]} failed`);
  }
  return result.stdout;
}

function reachableObjects(root, additionalRefs) {
  const output = git(root, ["rev-list", "--objects", "--all", ...additionalRefs], { encoding: "utf8" });
  const entries = [];
  const seen = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64})(?: (.*))?$/.exec(line);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    entries.push({ objectId: match[1], filePath: match[2] || "(unknown-history-path)" });
  }
  return entries;
}

function scannableEntries(root, entries) {
  const input = `${entries.map((entry) => entry.objectId).join("\n")}\n`;
  const output = git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    encoding: "utf8",
    input,
  });
  const byId = new Map(entries.map((entry) => [entry.objectId, entry]));
  const objects = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40,64}) (blob|commit|tag) (\d+)$/.exec(line);
    if (!match) continue;
    const entry = byId.get(match[1]);
    if (entry) objects.push({
      ...entry,
      kind: match[2],
      size: Number(match[3]),
      filePath: match[2] === "blob" ? entry.filePath : `(${match[2]}:${entry.objectId.slice(0, 12)})`,
    });
  }
  return objects;
}

function batches(entries) {
  const result = [];
  let batch = [];
  let size = 0;
  for (const entry of entries) {
    if (batch.length > 0 && size + entry.size > MAX_BATCH_BYTES) {
      result.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(entry);
    size += entry.size;
  }
  if (batch.length > 0) result.push(batch);
  return result;
}

function readBatch(root, entries) {
  const input = `${entries.map((entry) => entry.objectId).join("\n")}\n`;
  const output = git(root, ["cat-file", "--batch"], { input, encoding: null });
  const blobs = new Map();
  let offset = 0;
  while (offset < output.length) {
    const newline = output.indexOf(10, offset);
    if (newline < 0) throw new Error("git cat-file returned a truncated header");
    const header = output.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40,64}) (?:blob|commit|tag) (\d+)$/.exec(header);
    if (!match) throw new Error("git cat-file returned an unexpected object");
    const size = Number(match[2]);
    const start = newline + 1;
    const end = start + size;
    if (end >= output.length) throw new Error("git cat-file returned truncated blob data");
    blobs.set(match[1], output.subarray(start, end));
    offset = end + 1;
  }
  return blobs;
}

function historicalHighRiskPaths(root, additionalRefs) {
  const output = git(root, ["log", "--all", "--pretty=format:", "--name-only", "-z", ...additionalRefs], { encoding: "utf8" });
  return [...new Set(output.split("\0").map((name) => name.replace(/^\r?\n+/, "")).filter(Boolean))]
    .filter(forbiddenTrackedPath);
}

export function pushedObjectIds(input) {
  const ids = new Set();
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(fields[1])) {
      throw new Error("Invalid pre-push reference input; values redacted");
    }
    if (!/^0+$/.test(fields[1])) ids.add(fields[1]);
  }
  return [...ids];
}

export function scanGitHistory(root = process.cwd(), additionalRefs = []) {
  if (additionalRefs.some((ref) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref))) {
    throw new Error("Additional scan targets must be full object IDs; values redacted");
  }
  const findings = historicalHighRiskPaths(root, additionalRefs).map((filePath) => ({
    filePath,
    line: 1,
    rule: "forbidden-secret-file-in-history",
  }));
  const objects = scannableEntries(root, reachableObjects(root, additionalRefs));
  const scannable = [];
  for (const blob of objects) {
    if (blob.size > MAX_HISTORY_BLOB_BYTES) {
      findings.push({ filePath: blob.filePath, line: 1, rule: "history-object-too-large" });
    } else {
      scannable.push(blob);
    }
  }

  for (const batch of batches(scannable)) {
    const contents = readBatch(root, batch);
    for (const blob of batch) {
      const bytes = contents.get(blob.objectId);
      if (!bytes) throw new Error("git cat-file omitted a requested blob");
      findings.push(...scanBytes(blob.filePath, bytes).findings);
    }
  }

  return {
    blobCount: objects.filter((object) => object.kind === "blob").length,
    metadataCount: objects.filter((object) => object.kind !== "blob").length,
    findings,
  };
}

function main() {
  const additionalRefs = process.argv.includes("--pre-push") ? pushedObjectIds(fs.readFileSync(0, "utf8")) : [];
  const result = scanGitHistory(process.cwd(), additionalRefs);
  if (result.findings.length > 0) {
    console.error(`Repository history secret scan failed: ${result.findings.length} finding(s). Values are redacted.`);
    for (const finding of result.findings) console.error(`- ${finding.filePath}:${finding.line} [${finding.rule}]`);
    process.exit(1);
  }
  console.log(`Repository history secret scan passed (${result.blobCount} reachable blobs; ${result.metadataCount} commits/tags; values redacted; hits=0)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
