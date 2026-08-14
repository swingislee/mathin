const SHA256 = /^[0-9a-f]{64}$/;

const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "development",
  "test",
  "staging",
  "release-candidate",
  "isolated-rc",
  "isolated-production-snapshot",
]);

const PRODUCTION_ENVIRONMENT = "production";
const PRODUCTION_SUPABASE_ORIGIN = "https://supabase.mathin.club";
const PRODUCTION_SSH_TARGET = "xiaomi";
const PRODUCTION_TARGET_FINGERPRINT = "10e3f97e32b018403c9074efa4e258d699530a487c47de89b5d307ab7ff21a0c";
const PRODUCTION_EVIDENCE_FINGERPRINT = "799d6a9c5d2a6fd5ec8d5ff3bef7f36a251d3488a7b387ce01d057b096463e39";
const CONTROLLED_PRODUCTION_OPERATIONS = new Set(["cw:import", "cw:adapt-4x3"]);

const PRODUCTION_HOSTS = new Set([
  "mathin.club",
  "www.mathin.club",
  "supabase.mathin.club",
  PRODUCTION_SSH_TARGET,
]);
const PRODUCTION_SSH_TARGETS = new Set([PRODUCTION_SSH_TARGET]);
const PRODUCTION_FINGERPRINTS = new Set([
  PRODUCTION_TARGET_FINGERPRINT,
  PRODUCTION_EVIDENCE_FINGERPRINT,
]);

/**
 * @typedef {Object} WriteTargetOptions
 * @property {string} [operation]
 * @property {string} [supabaseUrl]
 * @property {string[]} [additionalSupabaseUrls]
 * @property {string} [databaseUrl]
 * @property {string} [sshHost]
 * @property {Record<string, string | undefined>} [environment]
 */

/**
 * @typedef {WriteTargetOptions & {
 *   allowProduction?: boolean,
 *   productionConfirmation?: string,
 * }} ControlledWriteTargetOptions
 */

function fail(code, message) {
  throw new Error(`R1_WRITE_TARGET_POLICY:${code}: ${message}`);
}

function normalizeHostname(value) {
  const lowered = String(value ?? "").trim().toLowerCase();
  const unbracketed = lowered.startsWith("[") && lowered.endsWith("]")
    ? lowered.slice(1, -1)
    : lowered;
  return unbracketed.replace(/\.+$/, "");
}

function originOnly(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("INVALID_TARGET", `${label} must be an absolute HTTP(S) origin`);
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    fail("INVALID_TARGET", `${label} must be an origin without credentials, path, query, or fragment`);
  }
  return { origin: url.origin, hostname: normalizeHostname(url.hostname) };
}

function databaseTarget(raw) {
  let url;
  let database;
  try {
    url = new URL(raw);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail("INVALID_TARGET", "DATABASE_URL must be an absolute PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !url.hostname
    || !database
    || database.includes("/")
    || url.search
    || url.hash) {
    fail("INVALID_TARGET", "DATABASE_URL must be an absolute PostgreSQL URL");
  }
  const hostname = normalizeHostname(url.hostname);
  const port = url.port || "5432";
  return { hostname, port, database, target: `${hostname}:${port}/${database}` };
}

function sshTarget(raw, label = "SSH target") {
  const value = String(raw ?? "").trim().toLowerCase().replace(/\.+$/, "");
  if (!/^(?:[a-z0-9._-]+@)?[a-z0-9._-]+$/.test(value) || value.startsWith("-")) {
    fail("INVALID_TARGET", `${label} is invalid`);
  }
  return { value, hostname: normalizeHostname(value.split("@").at(-1)) };
}

function isLoopback(hostname) {
  if (hostname === "localhost" || hostname === "::1") return true;
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  return octets.every((part) => part <= 255) && octets[0] === 127;
}

function inspectTargets({ supabaseUrl, additionalSupabaseUrls, databaseUrl, sshHost, environment }) {
  const supabaseTargets = [...new Map(
    [supabaseUrl, ...additionalSupabaseUrls]
      .filter(Boolean)
      .map((value, index) => {
        const target = originOnly(value, index === 0 ? "NEXT_PUBLIC_SUPABASE_URL" : "additional Supabase URL");
        return [target.origin, target];
      }),
  ).values()];
  const database = databaseUrl ? databaseTarget(databaseUrl) : null;
  const ssh = sshHost ? sshTarget(sshHost) : null;
  const fingerprint = environment.MATHIN_WRITE_TARGET_FINGERPRINT?.trim() || null;
  if (fingerprint && !SHA256.test(fingerprint)) {
    fail("INVALID_ATTESTATION", "MATHIN_WRITE_TARGET_FINGERPRINT must be lowercase 64-hex SHA-256");
  }
  const productionMarkers = {
    supabase: supabaseTargets.some((target) => PRODUCTION_HOSTS.has(target.hostname)),
    database: Boolean(database && PRODUCTION_HOSTS.has(database.hostname)),
    ssh: Boolean(ssh && (PRODUCTION_HOSTS.has(ssh.hostname)
      || PRODUCTION_SSH_TARGETS.has(ssh.value)
      || PRODUCTION_SSH_TARGETS.has(ssh.hostname))),
    fingerprint: Boolean(fingerprint && PRODUCTION_FINGERPRINTS.has(fingerprint)),
  };
  return {
    supabaseTargets,
    supabase: supabaseTargets[0] ?? null,
    database,
    ssh,
    fingerprint,
    productionMarkers,
    isProduction: Object.values(productionMarkers).some(Boolean),
  };
}

function assertExactAttestations(targets, environment) {
  if (targets.supabaseTargets.length > 0) {
    const allowedValues = [
      environment.MATHIN_WRITE_ALLOWED_SUPABASE_ORIGIN?.trim(),
      ...(environment.MATHIN_WRITE_ALLOWED_SUPABASE_ORIGINS ?? "").split(",").map((value) => value.trim()),
    ].filter(Boolean);
    const allowedOrigins = new Set(allowedValues.map((value) => originOnly(value, "allowed Supabase origin").origin));
    const selectedOrigins = new Set(targets.supabaseTargets.map((target) => target.origin));
    if (allowedOrigins.size !== selectedOrigins.size
      || [...selectedOrigins].some((origin) => !allowedOrigins.has(origin))) {
      fail("ATTESTATION_MISMATCH", "allowed Supabase origins must exactly match every selected Supabase write origin");
    }
  }
  if (targets.database) {
    const allowed = environment.MATHIN_WRITE_ALLOWED_DATABASE_TARGET?.trim().toLowerCase();
    if (!allowed || allowed !== targets.database.target) {
      fail("ATTESTATION_MISMATCH", "MATHIN_WRITE_ALLOWED_DATABASE_TARGET must exactly match DATABASE_URL host, port, and database name");
    }
  }
  if (targets.ssh) {
    const allowedRaw = environment.MATHIN_WRITE_ALLOWED_SSH_TARGET?.trim();
    if (!allowedRaw || sshTarget(allowedRaw, "MATHIN_WRITE_ALLOWED_SSH_TARGET").value !== targets.ssh.value) {
      fail("ATTESTATION_MISMATCH", "MATHIN_WRITE_ALLOWED_SSH_TARGET must exactly match the selected SSH target");
    }
  }
}

function productionConfirmationFor(operation) {
  return `${operation}:${PRODUCTION_TARGET_FINGERPRINT.slice(0, 16)}`;
}

function validateInput({ operation, additionalSupabaseUrls, supabaseUrl, databaseUrl, sshHost }) {
  if (typeof operation !== "string" || operation.trim() === "") {
    fail("INVALID_OPERATION", "operation is required");
  }
  if (!Array.isArray(additionalSupabaseUrls)
    || additionalSupabaseUrls.some((value) => typeof value !== "string" || value.trim() === "")) {
    fail("INVALID_TARGET", "additionalSupabaseUrls must contain absolute HTTP(S) origins");
  }
  if (!supabaseUrl && additionalSupabaseUrls.length === 0 && !databaseUrl && !sshHost) {
    fail("TARGET_REQUIRED", "at least one concrete write target is required");
  }
}

function resultFor(operation, targetEnvironment, targets, mode) {
  return {
    operation: operation.trim(),
    environment: targetEnvironment,
    mode,
    fingerprint: targets.fingerprint,
    targets: {
      supabaseOrigin: targets.supabase?.origin ?? null,
      supabaseOrigins: targets.supabaseTargets.map((target) => target.origin),
      databaseHost: targets.database?.hostname ?? null,
      databaseTarget: targets.database?.target ?? null,
      sshTarget: targets.ssh?.value ?? null,
    },
  };
}

/** @param {WriteTargetOptions} [options] */
export function assertNonProductionWriteTarget({
  operation,
  supabaseUrl,
  additionalSupabaseUrls = [],
  databaseUrl,
  sshHost,
  environment = process.env,
} = {}) {
  validateInput({ operation, supabaseUrl, additionalSupabaseUrls, databaseUrl, sshHost });
  const targets = inspectTargets({ supabaseUrl, additionalSupabaseUrls, databaseUrl, sshHost, environment });
  if (targets.isProduction) {
    fail("PRODUCTION_TARGET_BLOCKED", "development/test writers must never target the current Xiaomi production system");
  }

  const targetEnvironment = environment.MATHIN_WRITE_TARGET_ENVIRONMENT?.trim();
  if (!targetEnvironment) {
    fail("ATTESTATION_REQUIRED", "MATHIN_WRITE_TARGET_ENVIRONMENT is required for every write-capable command");
  }
  if (!NON_PRODUCTION_ENVIRONMENTS.has(targetEnvironment)) {
    fail("PRODUCTION_TARGET_BLOCKED", "development/test writers require an approved non-production environment");
  }
  assertExactAttestations(targets, environment);

  const hasRemoteTarget = targets.supabaseTargets.some((target) => !isLoopback(target.hostname))
    || Boolean(targets.database && !isLoopback(targets.database.hostname))
    || Boolean(targets.ssh);
  if (hasRemoteTarget) {
    fail("UNREGISTERED_REMOTE_TARGET", "no remote non-production target is registered; use loopback or add a reviewed target fingerprint first");
  }
  return resultFor(operation, targetEnvironment, targets, "non-production");
}

/** @param {ControlledWriteTargetOptions} [options] */
export function assertControlledContentWriteTarget({
  operation,
  supabaseUrl,
  additionalSupabaseUrls = [],
  databaseUrl,
  sshHost,
  environment = process.env,
  allowProduction = false,
  productionConfirmation,
} = {}) {
  validateInput({ operation, supabaseUrl, additionalSupabaseUrls, databaseUrl, sshHost });
  const targets = inspectTargets({ supabaseUrl, additionalSupabaseUrls, databaseUrl, sshHost, environment });
  const targetEnvironment = environment.MATHIN_WRITE_TARGET_ENVIRONMENT?.trim();
  if (!targets.isProduction && targetEnvironment !== PRODUCTION_ENVIRONMENT) {
    return assertNonProductionWriteTarget({
      operation,
      supabaseUrl,
      additionalSupabaseUrls,
      databaseUrl,
      sshHost,
      environment,
    });
  }

  if (!CONTROLLED_PRODUCTION_OPERATIONS.has(operation)) {
    fail("PRODUCTION_OPERATION_BLOCKED", "this operation has no controlled production write path");
  }
  if (targetEnvironment !== PRODUCTION_ENVIRONMENT) {
    fail("ATTESTATION_MISMATCH", "the Xiaomi production target requires MATHIN_WRITE_TARGET_ENVIRONMENT=production");
  }
  if (targets.supabase?.origin !== PRODUCTION_SUPABASE_ORIGIN
    || targets.supabaseTargets.some((target) => target.origin !== PRODUCTION_SUPABASE_ORIGIN)
    || targets.ssh?.value !== PRODUCTION_SSH_TARGET
    || targets.database) {
    fail("PRODUCTION_TARGET_MISMATCH", "controlled content writes require the exact public mathin.club Supabase/Storage origin and Xiaomi SSH target");
  }
  if (targets.fingerprint !== PRODUCTION_TARGET_FINGERPRINT) {
    fail("PRODUCTION_TARGET_MISMATCH", "controlled content writes require the stable registered production database fingerprint");
  }
  assertExactAttestations(targets, environment);
  if (!allowProduction) {
    fail("PRODUCTION_AUTHORIZATION_REQUIRED", "pass --allow-production-target only after the read-only preflight and backup gate are accepted");
  }
  if (productionConfirmation !== productionConfirmationFor(operation)) {
    fail("PRODUCTION_AUTHORIZATION_REQUIRED", "set the per-run production confirmation in the current Shell; .env.local is not accepted for this control");
  }
  return resultFor(operation, targetEnvironment, targets, "controlled-production");
}

export const R1_WRITE_TARGET_POLICY = Object.freeze({
  nonProductionEnvironments: Object.freeze([...NON_PRODUCTION_ENVIRONMENTS]),
  productionEnvironment: PRODUCTION_ENVIRONMENT,
  productionSupabaseOrigin: PRODUCTION_SUPABASE_ORIGIN,
  productionSshTarget: PRODUCTION_SSH_TARGET,
  productionTargetFingerprint: PRODUCTION_TARGET_FINGERPRINT,
  productionEvidenceFingerprint: PRODUCTION_EVIDENCE_FINGERPRINT,
  controlledProductionOperations: Object.freeze([...CONTROLLED_PRODUCTION_OPERATIONS]),
  productionConfirmationFor,
});
