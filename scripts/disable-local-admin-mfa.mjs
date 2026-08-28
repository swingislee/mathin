import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";

const APPLY_MODE = "--apply";
const CHECK_MODE = "--check";
const EXEMPT_CLAIM = "mathin_dev_mfa_exempt";
const mode = process.argv[2] ?? CHECK_MODE;
if (![CHECK_MODE, APPLY_MODE].includes(mode)) {
  throw new Error("Usage: node scripts/disable-local-admin-mfa.mjs [--check|--apply]");
}

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

function cleanCell(value) {
  return value.replace(/[*_`]/g, "").trim();
}

function readFixedAdminAccount() {
  const environmentEmail = process.env.MATHIN_E2E_ADMIN_EMAIL?.trim();
  const environmentPassword = process.env.MATHIN_E2E_PASSWORD?.trim();
  if (environmentEmail || environmentPassword) {
    if (!environmentEmail || !environmentPassword) throw new Error("Fixed admin environment credentials are incomplete");
    return { email: environmentEmail, password: environmentPassword };
  }

  const configuredPath = process.env.MATHIN_E2E_ACCOUNTS_FILE?.trim();
  const accountPath = configuredPath
    ? path.resolve(process.cwd(), configuredPath)
    : path.join(process.cwd(), ".claude", "test-accounts.local.md");
  if (!existsSync(accountPath)) throw new Error("Fixed development account document is unavailable");
  const markdown = readFileSync(accountPath, "utf8");
  const password = markdown.match(/统一密码[：:]\s*`([^`\r\n]+)`/)?.[1]?.trim();
  let email = "";
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cleanCell);
    if (/^管理员\s+admin(?:\s|$)/i.test(cells[0] ?? "")) {
      email = cells[1] ?? "";
      break;
    }
  }
  if (!password || !/^[^@\s]+@[^@\s]+$/.test(email)) {
    throw new Error("Fixed development administrator credentials could not be parsed");
  }
  return { email, password };
}

function requireData(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  if (!result.data) throw new Error(`${operation}: no data returned`);
  return result.data;
}

loadLocalEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !publishableKey || !secretKey) throw new Error("Local Supabase URL and keys are required");
assertNonProductionWriteTarget({ operation: "dev:admin-mfa:disable", supabaseUrl: url });

const hostname = new URL(url).hostname.toLowerCase();
if (!new Set(["localhost", "127.0.0.1", "[::1]"]).has(hostname)) {
  throw new Error("Local administrator MFA can only be disabled on loopback Supabase");
}

const account = readFixedAdminAccount();
const identity = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const login = requireData(await identity.auth.signInWithPassword(account), "authenticate fixed development administrator");
if (!login.user) throw new Error("Fixed development administrator did not return a user");
const userId = login.user.id;
try {
  const profile = requireData(
    await admin.from("profiles").select("role,account_status").eq("id", userId).single(),
    "verify fixed development administrator profile",
  );
  if (profile.role !== "admin" || profile.account_status !== "active") {
    throw new Error("MFA disable refused a non-active or non-admin fixed account");
  }

  const beforeFactors = requireData(
    await admin.auth.admin.mfa.listFactors({ userId }),
    "list fixed development administrator MFA factors",
  ).factors;
  const beforeUser = requireData(
    await admin.auth.admin.getUserById(userId),
    "read fixed development administrator app metadata",
  ).user;
  if (!beforeUser) throw new Error("Fixed development administrator Auth user was not found");

  if (mode === APPLY_MODE) {
    const updated = requireData(
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { ...beforeUser.app_metadata, [EXEMPT_CLAIM]: true },
      }),
      "set local development MFA exemption",
    );
    if (updated.user?.app_metadata?.[EXEMPT_CLAIM] !== true) {
      throw new Error("Local development MFA exemption was not persisted");
    }
    for (const factor of beforeFactors) {
      const result = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
      if (result.error) throw new Error(`delete fixed development MFA factor: ${result.error.message}`);
    }
  }

  const afterFactors = requireData(
    await admin.auth.admin.mfa.listFactors({ userId }),
    "verify fixed development administrator MFA factors",
  ).factors;
  const afterUser = requireData(
    await admin.auth.admin.getUserById(userId),
    "verify fixed development administrator app metadata",
  ).user;
  if (!afterUser) throw new Error("Fixed development administrator Auth user disappeared");
  if (mode === APPLY_MODE && (afterFactors.length !== 0 || afterUser.app_metadata?.[EXEMPT_CLAIM] !== true)) {
    throw new Error("Local administrator MFA disable postflight failed");
  }

  process.stdout.write(`${JSON.stringify({
    mode: mode === APPLY_MODE ? "apply" : "check",
    target: "loopback-fixed-admin",
    factorCountBefore: beforeFactors.length,
    factorCountAfter: afterFactors.length,
    localExemption: afterUser.app_metadata?.[EXEMPT_CLAIM] === true,
  })}\n`);
} finally {
  await identity.auth.signOut().catch(() => undefined);
}
