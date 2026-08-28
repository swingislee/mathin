export const LOCAL_DEVELOPMENT_MFA_EXEMPT_CLAIM = "mathin_dev_mfa_exempt";

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.+$/, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

/**
 * Fixed development administrators may opt out of MFA only when all three
 * boundaries agree: Next is running in development mode, Supabase is loopback,
 * and trusted Auth app_metadata contains the explicit local exemption claim.
 */
export function hasLocalDevelopmentMfaExemption(
  appMetadata: Record<string, unknown> | null | undefined,
  options: { nodeEnv: string | undefined; supabaseUrl: string | undefined },
) {
  if (options.nodeEnv !== "development") return false;
  if (appMetadata?.[LOCAL_DEVELOPMENT_MFA_EXEMPT_CLAIM] !== true) return false;
  if (!options.supabaseUrl) return false;
  try {
    return isLoopbackHostname(new URL(options.supabaseUrl).hostname);
  } catch {
    return false;
  }
}
