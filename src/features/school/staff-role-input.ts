export interface StaffRoleAlias {
  key: string;
  name: string;
}

function normalizedRoleToken(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

/** The spreadsheet contract uses whitespace between role names. */
export function splitStaffRoleInput(value: string): string[] {
  if (!value.trim()) return [];
  return [...new Set(value.trim().split(/\s+/u).map((token) => token.trim()).filter(Boolean))];
}

export function hasLegacyStaffRoleSeparator(value: string): boolean {
  return /[|,;；，]/u.test(value);
}

/** Resolve localized role names to stable keys; an ambiguous name stays invalid. */
export function canonicalizeStaffRoleTokens(tokens: string[], roles: StaffRoleAlias[]): string[] {
  const keys = new Map(roles.map((role) => [normalizedRoleToken(role.key), role.key]));
  const names = new Map<string, string | null>();
  for (const role of roles) {
    const alias = normalizedRoleToken(role.name);
    const existing = names.get(alias);
    names.set(alias, existing === undefined || existing === role.key ? role.key : null);
  }
  return [...new Set(tokens.map((token) => {
    const normalized = normalizedRoleToken(token);
    return keys.get(normalized) ?? names.get(normalized) ?? token.trim();
  }))];
}

export function staffRoleDisplayName(key: string, roles: StaffRoleAlias[], locale: string): string {
  const role = roles.find((item) => item.key === key);
  return locale === "zh" ? role?.name ?? key : role?.key ?? key;
}
