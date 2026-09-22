#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { forbiddenTrackedPath, scanBytes } from "./check-repository-secrets.mjs";

function git(root, args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error("Unable to inspect Git index; commit stopped.");
  return result.stdout;
}

export function scanStagedSecrets(root = process.cwd()) {
  const files = git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean);
  const findings = [];
  for (const filePath of files) {
    if (forbiddenTrackedPath(filePath)) {
      findings.push({ filePath, line: 1, rule: "forbidden-private-file" });
      continue;
    }
    // Read the index blob, so editing a secret out of the working file cannot hide a staged copy.
    const bytes = git(root, ["show", `:${filePath}`], null);
    findings.push(...scanBytes(filePath, bytes).findings);
    if (filePath === "apps/parent-wechat/project.config.json") {
      try {
        if (JSON.parse(bytes.toString("utf8")).appid !== "touristappid") {
          findings.push({ filePath, line: 1, rule: "wechat-appid-requires-private-config" });
        }
      } catch {
        findings.push({ filePath, line: 1, rule: "invalid-wechat-project-config" });
      }
    }
  }
  return { fileCount: files.length, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = scanStagedSecrets();
    if (result.findings.length) {
      console.error("Staged privacy scan failed. Values are redacted; keep credentials in ignored local configuration.");
      for (const { filePath, line, rule } of result.findings) console.error(`- ${filePath}:${line} [${rule}]`);
      process.exitCode = 1;
    } else console.log(`Staged privacy scan passed (${result.fileCount} files).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
