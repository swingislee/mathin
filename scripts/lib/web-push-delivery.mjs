const MAX_RETRY_AFTER_SECONDS = 4 * 60 * 60;

export function parseRetryAfterSeconds(value, now = Date.now()) {
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(numeric));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, Math.ceil((timestamp - now) / 1000)));
}
export function classifyWebPushFailure(error, now = Date.now()) {
  const statusCode = Number.isInteger(error?.statusCode) ? Number(error.statusCode) : null;
  if (statusCode === 404 || statusCode === 410) {
    return { kind: "gone", code: `PUSH_HTTP_${statusCode}`, retryable: false, retryAfterSeconds: null };
  }
  if (statusCode === 400 || statusCode === 413) {
    return { kind: "terminal", code: `PUSH_HTTP_${statusCode}`, retryable: false, retryAfterSeconds: null };
  }
  if (statusCode === 401 || statusCode === 403) {
    return { kind: "auth", code: `PUSH_HTTP_${statusCode}`, retryable: false, retryAfterSeconds: null };
  }
  if (statusCode === 429) {
    const retryAfter = error?.headers?.["retry-after"] ?? error?.headers?.get?.("retry-after");
    return {
      kind: "retry",
      code: "PUSH_HTTP_429",
      retryable: true,
      retryAfterSeconds: parseRetryAfterSeconds(retryAfter, now),
    };
  }
  if (statusCode !== null && statusCode >= 500 && statusCode <= 599) {
    return { kind: "retry", code: `PUSH_HTTP_${statusCode}`, retryable: true, retryAfterSeconds: null };
  }
  return { kind: "retry", code: "PUSH_NETWORK_FAILURE", retryable: true, retryAfterSeconds: null };
}

export function buildGenericWebPushPayload({ deliveryId, locale, expiresAt }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(deliveryId)) || (locale !== "zh" && locale !== "en")) {
    throw Object.assign(new Error("WEB_PUSH_PAYLOAD_INVALID"), { code: "WEB_PUSH_PAYLOAD_INVALID" });
  }
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw Object.assign(new Error("WEB_PUSH_DELIVERY_EXPIRED"), { code: "WEB_PUSH_DELIVERY_EXPIRED" });
  }
  return JSON.stringify({ v: 1, deliveryId, locale, expiresAt: expiry });
}

export function webPushTtlSeconds(expiresAt, now = Date.now()) {
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) return 0;
  return Math.max(0, Math.min(MAX_RETRY_AFTER_SECONDS, Math.floor((expiry - now) / 1000)));
}
