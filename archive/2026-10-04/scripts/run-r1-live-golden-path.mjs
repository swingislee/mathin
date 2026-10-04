#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { resolveE2ETarget } from "./lib/r1-e2e-target-policy.mjs";

function isLoopback(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

const environment = { ...process.env, R1_DEV_TEST_FIXTURES: "1" };
const target = resolveE2ETarget(environment);
if (!isLoopback(new URL(target.baseURL).hostname)) {
  throw new Error("R1-Live local Golden Path only runs against a loopback application target");
}
if (target.releaseMode) throw new Error("R1-Live local Golden Path is excluded from release-target runs");

const cli = path.resolve("node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(process.execPath, [
  cli,
  "test",
  "e2e/r1-live-golden-path.spec.ts",
  "--project=r1-live-local-chromium",
], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
