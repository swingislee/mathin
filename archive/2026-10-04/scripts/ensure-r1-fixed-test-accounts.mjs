/**
 * Reconcile the gitignored fixed-account manifest into an explicitly attested
 * non-production Supabase target. Account identifiers and passwords stay in
 * `.claude/test-accounts.local.md`; this script never logs them.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertNonProductionWriteTarget } from "./lib/r1-write-target-policy.mjs";

const MANIFEST_PATH = path.join(process.cwd(), ".claude", "test-accounts.local.md");
const FIXED_DOMAIN = "mathin.local";
const STAFF_ROLE_KEYS = ["teacher", "research", "sales", "principal", "registrar"];

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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

function markdownCells(line) {
  return line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ""));
}

function classifyAccount(roleLabels) {
  const label = roleLabels.join(" ").toLowerCase();
  if (/\badmin\b/.test(label)) return { profileRole: "admin", staffRoles: [] };
  if (/\bparent\b/.test(label)) return { profileRole: "parent", staffRoles: [] };
  if (/\bstudent\b/.test(label)) return { profileRole: "student", staffRoles: [] };
  if (!/\bstaff\b/.test(label)) throw new Error("Fixed account manifest contains an unclassified role");
  const staffRoles = STAFF_ROLE_KEYS.filter((key) => new RegExp(`\\b${key}\\b`).test(label));
  if (staffRoles.length === 0) throw new Error("Fixed staff account has no recognized staff role");
  return { profileRole: "staff", staffRoles };
}

function fallbackDisplayName(roleLabels) {
  return roleLabels[0]
    .replace(/\bstaff\/[a-z+]+\b/gi, "")
    .replace(/\b(admin|parent|student)\b/gi, "")
    .trim() || "固定开发账号";
}

export function parseFixedAccountManifest(text) {
  const passwordMatch = text.match(/\*\*统一密码：(.+?)\*\*/);
  if (!passwordMatch?.[1]) throw new Error("Unified fixed-account password is missing");
  const markdownPassword = passwordMatch[1].trim();
  const password = markdownPassword.startsWith("`") && markdownPassword.endsWith("`")
    ? markdownPassword.slice(1, -1) : markdownPassword;

  let headers = null;
  const byEmail = new Map();
  let accountRows = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim().startsWith("|")) {
      headers = null;
      continue;
    }
    const cells = markdownCells(rawLine);
    if (cells.some((cell) => /邮箱|email/i.test(cell))) {
      headers = cells;
      continue;
    }
    if (!headers || cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
    const emailIndex = headers.findIndex((cell) => /邮箱|email/i.test(cell));
    const roleIndex = headers.findIndex((cell) => /角色|role/i.test(cell));
    const displayIndex = headers.findIndex((cell) => /display_name/i.test(cell));
    const email = cells[emailIndex]?.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+/i)?.[0].toLowerCase();
    if (!email?.endsWith(`@${FIXED_DOMAIN}`)) continue;
    const roleLabel = cells[roleIndex]?.trim();
    if (!roleLabel) throw new Error("Fixed account row is missing its role label");
    accountRows += 1;
    const current = byEmail.get(email) ?? { email, displayName: "", roleLabels: [] };
    current.displayName ||= displayIndex >= 0 ? cells[displayIndex]?.trim() : "";
    if (!current.roleLabels.includes(roleLabel)) current.roleLabels.push(roleLabel);
    byEmail.set(email, current);
  }

  const accounts = [...byEmail.values()].map((account) => ({
    ...account,
    displayName: account.displayName || fallbackDisplayName(account.roleLabels),
    ...classifyAccount(account.roleLabels),
  })).sort((left, right) => left.email.localeCompare(right.email));
  if (accounts.length === 0) throw new Error("Fixed account manifest contains no accounts");
  return { password, accounts, accountRows };
}

async function listAllUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error("Unable to list fixed test users");
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

async function reconcileAccounts(admin, manifest) {
  const { data: invite, error: inviteError } = await admin
    .from("registration_invite_settings")
    .select("code,is_active")
    .eq("id", 1)
    .single();
  if (inviteError || !invite?.is_active || !invite.code) {
    throw new Error("An active local registration invite setting is required");
  }

  const existing = new Map((await listAllUsers(admin)).map((user) => [user.email?.toLowerCase(), user]));
  const resolved = [];
  let created = 0;
  let updated = 0;
  for (const account of manifest.accounts) {
    let user = existing.get(account.email);
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: manifest.password,
        email_confirm: true,
        user_metadata: {
          display_name: account.displayName,
          registration_invite_code: invite.code,
          privacy_consent: true,
          children_privacy_consent: true,
        },
      });
      if (error || !data.user) throw new Error("Unable to create a fixed local test user");
      user = data.user;
      created += 1;
    } else {
      const { data, error } = await admin.auth.admin.updateUserById(user.id, {
        password: manifest.password,
        email_confirm: true,
        user_metadata: { ...user.user_metadata, display_name: account.displayName },
      });
      if (error || !data.user) throw new Error("Unable to refresh a fixed local test user");
      user = data.user;
      updated += 1;
    }
    const { error: profileError } = await admin.from("profiles").update({
      display_name: account.displayName,
      role: account.profileRole,
      is_active: true,
      account_status: "active",
    }).eq("id", user.id);
    if (profileError) throw new Error("Unable to reconcile a fixed local profile");
    resolved.push({ ...account, id: user.id });
  }

  const desiredRoleKeys = [...new Set(resolved.flatMap((account) => account.staffRoles))];
  const { data: roleRows, error: roleError } = await admin
    .from("staff_roles")
    .select("id,key")
    .in("key", desiredRoleKeys);
  if (roleError || roleRows.length !== desiredRoleKeys.length) {
    throw new Error("Local staff role registry does not match the fixed account manifest");
  }
  const roleIds = new Map(roleRows.map((role) => [role.key, role.id]));
  const memberships = resolved.flatMap((account) => account.staffRoles.map((key) => ({
    user_id: account.id,
    role_id: roleIds.get(key),
  })));
  if (memberships.length > 0) {
    const { error } = await admin.from("staff_role_members").upsert(memberships, {
      onConflict: "user_id,role_id",
      ignoreDuplicates: true,
    });
    if (error) throw new Error("Unable to reconcile fixed local staff role memberships");
  }
  return { resolved, created, updated, memberships: memberships.length };
}

async function verifyPasswordLogins(url, publishableKey, manifest, resolved) {
  let verified = 0;
  for (const account of resolved) {
    const client = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: account.email,
      password: manifest.password,
    });
    if (error || data.user?.id !== account.id) throw new Error("A fixed local password login did not resolve to its account");
    await client.auth.signOut();
    verified += 1;
  }
  return verified;
}

loadLocalEnv();
if (process.env.R1_DEV_TEST_FIXTURES !== "1") {
  throw new Error("Set R1_DEV_TEST_FIXTURES=1 to reconcile fixed development accounts");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !secretKey || !publishableKey) throw new Error("Local Supabase URL and keys are required");
assertNonProductionWriteTarget({ operation: "r1:fixed-accounts", supabaseUrl: url });
if (!fs.existsSync(MANIFEST_PATH)) throw new Error("The gitignored fixed account manifest is required");

const manifest = parseFixedAccountManifest(fs.readFileSync(MANIFEST_PATH, "utf8"));
const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const result = await reconcileAccounts(admin, manifest);
const loginVerified = await verifyPasswordLogins(url, publishableKey, manifest, result.resolved);
const roleDistribution = Object.entries(Object.groupBy(result.resolved, (account) => account.profileRole))
  .map(([role, accounts]) => ({ role, count: accounts.length }))
  .sort((left, right) => left.role.localeCompare(right.role));
const staffRoleDistribution = STAFF_ROLE_KEYS.map((role) => ({
  role,
  count: result.resolved.filter((account) => account.staffRoles.includes(role)).length,
})).filter(({ count }) => count > 0);

console.log(JSON.stringify({
  target: "attested-non-production",
  manifestRows: manifest.accountRows,
  uniqueAccounts: manifest.accounts.length,
  created: result.created,
  updated: result.updated,
  staffRoleMemberships: result.memberships,
  passwordLoginsVerified: loginVerified,
  roleDistribution,
  staffRoleDistribution,
}, null, 2));
