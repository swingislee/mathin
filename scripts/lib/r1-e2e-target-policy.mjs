const DEFAULT_BASE_URL = "http://127.0.0.1:3130";
const SHA256 = /^[0-9a-f]{64}$/;
const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "development",
  "test",
  "staging",
  "release-candidate",
  "isolated-rc",
]);
const PRODUCTION_HOSTS = new Set(["mathin.club", "www.mathin.club"]);

function fail(message) {
  throw new Error(message);
}

function originOnly(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} must be an absolute HTTP(S) origin`);
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    fail(`${label} must be an origin without credentials, path, query, or fragment`);
  }
  return url;
}

function privateIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;
  return octets[0] === 127
    || octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function isLoopbackOrRfc1918(url) {
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  return hostname === "localhost" || hostname === "[::1]" || privateIpv4(hostname);
}

function requireTargetAttestation(url, environment) {
  const allowedOrigin = environment.MATHIN_E2E_ALLOWED_ORIGIN?.trim();
  if (allowedOrigin !== url.origin) fail("MATHIN_E2E_ALLOWED_ORIGIN must exactly equal the selected target origin");

  const fingerprint = environment.MATHIN_E2E_TARGET_FINGERPRINT?.trim();
  if (!SHA256.test(fingerprint ?? "")) fail("MATHIN_E2E_TARGET_FINGERPRINT must be a lowercase 64-hex fingerprint");

  const fixedAccountEnvironment = environment.MATHIN_E2E_FIXED_ACCOUNT_ENVIRONMENT?.trim();
  if (!NON_PRODUCTION_ENVIRONMENTS.has(fixedAccountEnvironment ?? "")) {
    fail("MATHIN_E2E_FIXED_ACCOUNT_ENVIRONMENT must name an approved non-production environment");
  }
  return { fingerprint, fixedAccountEnvironment };
}

export function resolveE2ETarget(environment = process.env) {
  const releaseMode = environment.MATHIN_E2E_MODE === "release";
  const rawBaseURL = environment.MATHIN_E2E_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = originOnly(rawBaseURL, "MATHIN_E2E_BASE_URL");
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (PRODUCTION_HOSTS.has(hostname)) fail("fixed-account E2E must never target the production hostname");

  const localNetwork = isLoopbackOrRfc1918(url);
  let attestation = { fingerprint: null, fixedAccountEnvironment: null };
  if (!localNetwork || releaseMode) attestation = requireTargetAttestation(url, environment);

  if (releaseMode) {
    if (!environment.MATHIN_E2E_BASE_URL?.trim()) fail("release mode requires an explicit MATHIN_E2E_BASE_URL");
    if (environment.MATHIN_E2E_NO_WEBSERVER !== "1") fail("release mode requires MATHIN_E2E_NO_WEBSERVER=1");
  }

  return {
    baseURL: url.origin,
    localNetwork,
    releaseMode,
    ...attestation,
  };
}

export function resolveLanTarget(environment = process.env) {
  const raw = environment.MATHIN_E2E_LAN_BASE_URL?.trim();
  if (!raw) {
    if (environment.MATHIN_E2E_MODE === "release") fail("release mode requires MATHIN_E2E_LAN_BASE_URL");
    return null;
  }
  const url = originOnly(raw, "MATHIN_E2E_LAN_BASE_URL");
  if (!isLoopbackOrRfc1918(url)) fail("MATHIN_E2E_LAN_BASE_URL must be loopback or RFC1918");
  return url.origin;
}
