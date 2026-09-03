import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_ENDPOINT_LENGTH = 2048;

function requireKey(keyBase64) {
  const key = Buffer.from(String(keyBase64 || ""), "base64");
  if (key.length !== 32) throw Object.assign(new Error("WEB_PUSH_SECRETS_UNAVAILABLE"), { code: "WEB_PUSH_SECRETS_UNAVAILABLE" });
  return key;
}

function normalizeAllowedOrigins(raw) {
  const values = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const origins = new Set();
  for (const item of values) {
    const value = String(item).trim();
    if (!value) continue;
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw Object.assign(new Error("WEB_PUSH_ALLOWED_ORIGIN_INVALID"), { code: "WEB_PUSH_ALLOWED_ORIGIN_INVALID" });
    }
    if (isIP(parsed.hostname)) throw Object.assign(new Error("WEB_PUSH_ALLOWED_ORIGIN_INVALID"), { code: "WEB_PUSH_ALLOWED_ORIGIN_INVALID" });
    origins.add(parsed.origin);
  }
  return origins;
}

export function validateWebPushEndpoint(endpoint, allowedOrigins) {
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > MAX_ENDPOINT_LENGTH) {
    throw Object.assign(new Error("WEB_PUSH_ENDPOINT_INVALID"), { code: "WEB_PUSH_ENDPOINT_INVALID" });
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw Object.assign(new Error("WEB_PUSH_ENDPOINT_INVALID"), { code: "WEB_PUSH_ENDPOINT_INVALID" });
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.hash
    || isIP(parsed.hostname)
    || parsed.pathname === "/"
  ) {
    throw Object.assign(new Error("WEB_PUSH_ENDPOINT_INVALID"), { code: "WEB_PUSH_ENDPOINT_INVALID" });
  }
  const origins = normalizeAllowedOrigins(allowedOrigins);
  if (origins.size === 0 || !origins.has(parsed.origin)) {
    throw Object.assign(new Error("WEB_PUSH_ORIGIN_NOT_ALLOWED"), { code: "WEB_PUSH_ORIGIN_NOT_ALLOWED" });
  }
  return parsed.toString();
}

export function normalizeBrowserPushSubscription(value, allowedOrigins) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("VALIDATION"), { code: "VALIDATION" });
  }
  const endpoint = validateWebPushEndpoint(value.endpoint, allowedOrigins);
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  const base64Url = /^[A-Za-z0-9_-]+$/;
  if (
    typeof p256dh !== "string" || p256dh.length < 40 || p256dh.length > 200 || !base64Url.test(p256dh)
    || typeof auth !== "string" || auth.length < 12 || auth.length > 100 || !base64Url.test(auth)
    || (value.expirationTime !== null && value.expirationTime !== undefined
      && (!Number.isFinite(value.expirationTime) || value.expirationTime <= Date.now()))
  ) {
    throw Object.assign(new Error("VALIDATION"), { code: "VALIDATION" });
  }
  return {
    endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: { p256dh, auth },
  };
}

export function fingerprintWebPushEndpoint(endpoint, fingerprintSecret) {
  const secret = Buffer.from(String(fingerprintSecret || ""), "utf8");
  if (secret.length < 32) throw Object.assign(new Error("WEB_PUSH_SECRETS_UNAVAILABLE"), { code: "WEB_PUSH_SECRETS_UNAVAILABLE" });
  return createHmac("sha256", secret).update(endpoint, "utf8").digest("hex");
}

export function encryptWebPushSubscription(subscription, keyBase64) {
  const key = requireKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify({ v: ENVELOPE_VERSION, subscription }), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, encrypted]).toString("base64");
}

export function decryptWebPushSubscription(envelopeBase64, keyBase64) {
  const key = requireKey(keyBase64);
  const envelope = Buffer.from(String(envelopeBase64 || ""), "base64");
  if (envelope.length <= 1 + IV_BYTES + TAG_BYTES || envelope[0] !== ENVELOPE_VERSION) {
    throw Object.assign(new Error("WEB_PUSH_ENVELOPE_INVALID"), { code: "WEB_PUSH_ENVELOPE_INVALID" });
  }
  const iv = envelope.subarray(1, 1 + IV_BYTES);
  const tag = envelope.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const encrypted = envelope.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
  } catch {
    throw Object.assign(new Error("WEB_PUSH_ENVELOPE_INVALID"), { code: "WEB_PUSH_ENVELOPE_INVALID" });
  }
  if (parsed?.v !== ENVELOPE_VERSION) {
    throw Object.assign(new Error("WEB_PUSH_ENVELOPE_INVALID"), { code: "WEB_PUSH_ENVELOPE_INVALID" });
  }
  return parsed.subscription;
}

export function constantTimeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left), "utf8");
  const rightBuffer = Buffer.from(String(right), "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
