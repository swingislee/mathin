#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TOKEN_RULES = [
  ["private-key", /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g],
  ["github-fine-grained-token", /\bgithub_pat_[A-Za-z0-9_]{40,255}\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["stripe-live-secret", /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g],
  ["slack-token", /\bxox[baprs]-[0-9A-Za-z-]{20,255}\b/g],
  ["supabase-secret-key", /\bsb_secret_[0-9A-Za-z._-]{20,255}\b/g],
];

const CREDENTIAL_URL = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?):\/\/([^:\s/@]+):([^@\s/]+)@([^/\s'"`]+)/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const ENV_ASSIGNMENT = /^(?:export[ \t]+)?([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*([^\s#]{8,})[ \t]*$/gm;
const SENSITIVE_ENV_NAME = /PASSWORD|PASS|SECRET|TOKEN|PRIVATE_KEY|SERVICE_ROLE_KEY|API_KEY/;
const STRICT_PLACEHOLDERS = new Set([
  "not-a-secret",
  "not-a-real-secret",
  "ci-placeholder-publishable-key",
]);
const HIGH_RISK_EXTENSIONS = new Set([
  ".7z",
  ".bz2",
  ".der",
  ".gz",
  ".jks",
  ".kdbx",
  ".key",
  ".p12",
  ".pem",
  ".pfx",
  ".rar",
  ".tar",
  ".tgz",
  ".xz",
  ".zip",
]);

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function placeholder(value) {
  const unquoted = value.replace(/^(?:'([^']*)'|"([^"]*)")$/, "$1$2");
  const normalized = unquoted.toLowerCase();
  return STRICT_PLACEHOLDERS.has(normalized)
    || /^replace-with(?:[-_.][a-z0-9]+)+$/i.test(unquoted)
    || /^<[^<>\r\n]+>$/.test(unquoted);
}

function runtimeReference(value) {
  const unquoted = value.replace(/^(?:'([^']*)'|"([^"]*)")$/, "$1$2");
  return /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(unquoted)
    || /^process\.env\.[A-Z_][A-Z0-9_]*$/.test(unquoted);
}

function nonLiteralValue(value) {
  return placeholder(value) || runtimeReference(value);
}

function addFinding(findings, filePath, text, index, rule) {
  findings.push({ filePath, line: lineNumber(text, index), rule });
}

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function scanText(filePath, text) {
  const findings = [];
  for (const [rule, pattern] of TOKEN_RULES) {
    for (const match of text.matchAll(pattern)) addFinding(findings, filePath, text, match.index, rule);
  }

  for (const match of text.matchAll(CREDENTIAL_URL)) {
    const [, , password, host] = match;
    const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
    const localOrDocumentation = normalizedHost === "localhost"
      || normalizedHost === "127.0.0.1"
      || normalizedHost === "::1"
      || normalizedHost.endsWith(".test")
      || normalizedHost.endsWith(".invalid");
    if (!localOrDocumentation && !nonLiteralValue(password)) {
      addFinding(findings, filePath, text, match.index, "credential-url");
    }
  }

  for (const match of text.matchAll(JWT)) {
    const payload = decodeJwtPayload(match[0]);
    if (payload?.role === "service_role") {
      addFinding(findings, filePath, text, match.index, "supabase-service-role-jwt");
    }
  }

  for (const match of text.matchAll(ENV_ASSIGNMENT)) {
    if (SENSITIVE_ENV_NAME.test(match[1]) && !nonLiteralValue(match[2])) {
      addFinding(findings, filePath, text, match.index, "literal-secret-assignment");
    }
  }

  return findings;
}

export function forbiddenTrackedPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized).toLowerCase();
  if (basename !== ".env.example"
    && (basename === ".env" || basename.startsWith(".env.") || basename.endsWith(".env"))) return true;
  if (HIGH_RISK_EXTENSIONS.has(path.posix.extname(basename))) return true;
  return ["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"].includes(basename);
}

export function extractPrintableAscii(bytes, minimumLength = 4) {
  const strings = [];
  let current = [];
  const flush = () => {
    if (current.length >= minimumLength) strings.push(Buffer.from(current).toString("ascii"));
    current = [];
  };

  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) current.push(byte);
    else flush();
  }
  flush();
  return strings.join("\n");
}

export function scanBytes(filePath, bytes) {
  if (bytes.includes(0)) return { binary: true, findings: scanText(filePath, extractPrintableAscii(bytes)) };
  return { binary: false, findings: scanText(filePath, bytes.toString("utf8")) };
}

function trackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", shell: false, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.split("\0").filter(Boolean);
}

export function scanRepository(root = process.cwd(), files = trackedFiles(root)) {
  const findings = [];
  let textFileCount = 0;
  let binaryFileCount = 0;

  for (const filePath of files) {
    if (forbiddenTrackedPath(filePath)) {
      findings.push({ filePath, line: 1, rule: "forbidden-secret-file" });
      continue;
    }
    const absolutePath = path.join(root, filePath);
    if (!fs.existsSync(absolutePath)) continue;
    const bytes = fs.readFileSync(absolutePath);
    const scanned = scanBytes(filePath, bytes);
    if (scanned.binary) binaryFileCount += 1;
    else textFileCount += 1;
    findings.push(...scanned.findings);
  }

  return { trackedFileCount: files.length, textFileCount, binaryFileCount, findings };
}

function main() {
  const result = scanRepository();
  if (result.findings.length > 0) {
    console.error(`Repository secret scan failed: ${result.findings.length} high-confidence finding(s). Values are redacted.`);
    for (const finding of result.findings) {
      console.error(`- ${finding.filePath}:${finding.line} [${finding.rule}]`);
    }
    process.exit(1);
  }
  console.log(`Repository secret scan passed (${result.trackedFileCount} tracked files; ${result.textFileCount} text; ${result.binaryFileCount} binary ASCII-scanned; high-confidence hits=0)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
