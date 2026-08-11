#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveE2ETarget, resolveLanTarget } from "./lib/r1-e2e-target-policy.mjs";

const EXPECTED_TEST_COUNT = 9;

function fail(message) {
  console.error(`R1 Playwright release gate failed: ${message}`);
  process.exitCode = 1;
}

export function validateReleaseStats(stats) {
  const expected = Number(stats?.expected ?? -1);
  const skipped = Number(stats?.skipped ?? -1);
  const unexpected = Number(stats?.unexpected ?? -1);
  const flaky = Number(stats?.flaky ?? -1);
  const total = expected + skipped + unexpected + flaky;
  return {
    expected,
    skipped,
    unexpected,
    flaky,
    total,
    passed: expected === EXPECTED_TEST_COUNT
      && total === EXPECTED_TEST_COUNT
      && skipped === 0
      && unexpected === 0
      && flaky === 0,
  };
}

export function main() {
  const environment = { ...process.env, MATHIN_E2E_MODE: "release" };
  try {
    resolveE2ETarget(environment);
    resolveLanTarget(environment);
  } catch (error) {
    fail(error instanceof Error ? error.message : "target policy rejected the run");
    return;
  }

  const cli = path.resolve("node_modules", "@playwright", "test", "cli.js");
  const result = spawnSync(process.execPath, [cli, "test", "--reporter=json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });

  let report;
  try {
    report = JSON.parse(result.stdout || "");
  } catch {
    fail("Playwright did not return a parseable in-memory JSON report");
    return;
  }

  const summary = validateReleaseStats(report.stats);
  console.log(`R1 Playwright release summary: expected=${summary.expected}; skipped=${summary.skipped}; unexpected=${summary.unexpected}; flaky=${summary.flaky}`);
  if (result.status !== 0 || !summary.passed) fail(`expected ${EXPECTED_TEST_COUNT} passing tests with zero skipped, unexpected, or flaky results`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
