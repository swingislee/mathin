import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const FIXED_ACCOUNT_SKIP_REASON =
  "fixed development account credentials are unavailable; set MATHIN_E2E_* variables or provide .claude/test-accounts.local.md";

export type FixedAccountRole = "admin" | "teacher" | "student" | "parent";

export interface FixedAccount {
  email: string;
  password: string;
}

interface ParsedAccountDocument {
  password: string | null;
  emails: Partial<Record<FixedAccountRole, string>>;
}

const ROLE_ENV_KEYS: Record<FixedAccountRole, string> = {
  admin: "MATHIN_E2E_ADMIN_EMAIL",
  teacher: "MATHIN_E2E_TEACHER_EMAIL",
  student: "MATHIN_E2E_STUDENT_EMAIL",
  parent: "MATHIN_E2E_PARENT_EMAIL",
};

const ROLE_LABELS: ReadonlyArray<readonly [FixedAccountRole, RegExp]> = [
  ["admin", /^管理员\s+admin(?:\s|$)/i],
  ["teacher", /^教师\s+staff\/teacher(?:\s|$)/i],
  ["student", /^学生\s+student(?:\s|$)/i],
  ["parent", /^家长\s+parent(?:\s|$)/i],
];

function cleanMarkdownCell(value: string): string {
  return value.replace(/[*_`]/g, "").trim();
}

function validEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^@\s]+@[^@\s]+$/.test(value));
}

export function parseFixedAccountDocument(markdown: string): ParsedAccountDocument {
  const passwordMatch = markdown.match(/统一密码[：:]\s*`([^`\r\n]+)`/);
  const emails: ParsedAccountDocument["emails"] = {};

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map(cleanMarkdownCell);
    if (cells.length < 2) continue;

    const role = ROLE_LABELS.find(([, pattern]) => pattern.test(cells[0]))?.[0];
    const email = cells[1];
    if (role && validEmail(email)) emails[role] = email;
  }

  return {
    password: passwordMatch?.[1].trim() || null,
    emails,
  };
}

function readLocalAccountDocument(environment: NodeJS.ProcessEnv, cwd: string): ParsedAccountDocument | null {
  const configuredPath = environment.MATHIN_E2E_ACCOUNTS_FILE?.trim();
  const accountPath = configuredPath
    ? path.resolve(cwd, configuredPath)
    : path.join(cwd, ".claude", "test-accounts.local.md");

  if (!existsSync(accountPath)) return null;
  try {
    return parseFixedAccountDocument(readFileSync(accountPath, "utf8"));
  } catch {
    return null;
  }
}

export function loadFixedAccount(
  role: FixedAccountRole,
  options: { environment?: NodeJS.ProcessEnv; cwd?: string } = {},
): FixedAccount | null {
  const environment = options.environment ?? process.env;
  const envEmail = environment[ROLE_ENV_KEYS[role]]?.trim();
  const envPassword = environment.MATHIN_E2E_PASSWORD?.trim();

  // Explicit but partial environment configuration must not silently mix with a
  // local credential file. The affected role is skipped instead.
  if (envEmail || envPassword) {
    return validEmail(envEmail) && envPassword ? { email: envEmail, password: envPassword } : null;
  }

  const document = readLocalAccountDocument(environment, options.cwd ?? process.cwd());
  const email = document?.emails[role];
  return validEmail(email) && document?.password ? { email, password: document.password } : null;
}
