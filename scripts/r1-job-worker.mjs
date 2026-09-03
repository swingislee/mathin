import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  constantTimeStringEqual,
  decryptWebPushSubscription,
  fingerprintWebPushEndpoint,
  normalizeBrowserPushSubscription,
} from "../src/features/events/web-push-runtime.mjs";
import {
  buildGenericWebPushPayload,
  classifyWebPushFailure,
  webPushTtlSeconds,
} from "./lib/web-push-delivery.mjs";

const VERSION = "r1-7.2-web-push";
const MAX_BATCH = 100;

async function loadLocalEnv() {
  try {
    const text = await readFile(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await loadLocalEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  process.exit(2);
}

const workerId = (process.env.R1_JOB_WORKER_ID || `${os.hostname()}:${process.pid}`).slice(0, 160);
const batchSize = Math.max(1, Math.min(MAX_BATCH, Number(process.env.R1_JOB_BATCH || 10)));
const leaseSeconds = Math.max(30, Math.min(3600, Number(process.env.R1_JOB_LEASE_SECONDS || 300)));
const pollMs = Math.max(250, Math.min(60000, Number(process.env.R1_JOB_POLL_MS || 2000)));
const once = process.env.R1_JOB_ONCE === "1";
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
let webPushModulePromise;

async function webPushClient() {
  if (!webPushModulePromise) {
    webPushModulePromise = import("web-push").then((module) => module.default ?? module);
  }
  try {
    return await webPushModulePromise;
  } catch {
    webPushModulePromise = undefined;
    throw Object.assign(new Error("Web Push provider module is unavailable."), {
      code: "WEB_PUSH_PROVIDER_UNAVAILABLE",
      retryable: false,
      configurationFailure: true,
    });
  }
}

function signatureMatches(mime, bytes) {
  const hex = bytes.toString("hex");
  const ascii = bytes.toString("ascii");
  if (mime === "image/jpeg") return hex.startsWith("ffd8ff");
  if (mime === "image/png") return hex.startsWith("89504e470d0a1a0a");
  if (mime === "image/gif") return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
  if (mime === "image/webp") return ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP";
  if (mime === "image/avif") return ascii.slice(4, 12).startsWith("ftypavif") || ascii.slice(4, 12).startsWith("ftypavis");
  if (mime === "video/webm") return hex.startsWith("1a45dfa3");
  if (mime === "video/mp4" || mime === "video/quicktime") return ascii.slice(4, 8) === "ftyp";
  return false;
}

async function hashStorageObject(bucketId, objectPath) {
  const { data: signed, error: signedError } = await admin.storage.from(bucketId).createSignedUrl(objectPath, 300);
  if (signedError || !signed?.signedUrl) throw new Error(`SIGNED_URL:${signedError?.message || "missing URL"}`);
  const response = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error(`DOWNLOAD_HTTP_${response.status}`);
  const hash = createHash("sha256");
  const signatureParts = [];
  let signatureBytes = 0;
  let byteCount = 0;
  for await (const value of response.body) {
    const chunk = Buffer.from(value);
    hash.update(chunk);
    byteCount += chunk.length;
    if (signatureBytes < 32) {
      const part = chunk.subarray(0, 32 - signatureBytes);
      signatureParts.push(part);
      signatureBytes += part.length;
    }
  }
  return { sha256: hash.digest("hex"), byteCount, signature: Buffer.concat(signatureParts) };
}

async function reserveEffect(job) {
  const { data, error } = await admin.rpc("reserve_job_effect", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_effect_key: job.effect_key,
  });
  if (error) throw new Error(`EFFECT_RESERVE:${error.message}`);
  return data === true;
}

async function completeEffect(job, result) {
  const { error } = await admin.rpc("complete_job_effect", {
    p_job_id: job.job_id,
    p_lease_token: job.lease_token,
    p_effect_key: job.effect_key,
    p_result: result,
  });
  if (error) throw new Error(`EFFECT_COMPLETE:${error.message}`);
}

async function verifyFile(job) {
  if (!(await reserveEffect(job))) return { deduplicated: true };
  const fileId = job.payload?.fileId;
  const { data: file, error } = await admin.from("managed_files")
    .select("id,bucket_id,object_path,mime_type,byte_count")
    .eq("id", fileId).maybeSingle();
  if (error || !file) throw new Error(`FILE_NOT_FOUND:${error?.message || fileId}`);
  const actual = await hashStorageObject(file.bucket_id, file.object_path);
  const clean = actual.byteCount === Number(file.byte_count) && signatureMatches(file.mime_type, actual.signature);
  const { error: finishError } = await admin.rpc("finish_file_verification", {
    p_file_id: file.id,
    p_sha256: actual.sha256,
    p_byte_count: actual.byteCount,
    p_clean: clean,
    p_error: clean ? null : "Declared size or media signature did not match the stored object.",
  });
  if (finishError) throw new Error(`FILE_VERIFY:${finishError.message}`);
  const result = { fileId: file.id, clean, byteCount: actual.byteCount, sha256: actual.sha256 };
  await completeEffect(job, result);
  return result;
}

async function cleanupFile(job) {
  if (!(await reserveEffect(job))) return { deduplicated: true };
  const { fileId, bucketId, objectPath } = job.payload || {};
  const { error: removeError } = await admin.storage.from(bucketId).remove([objectPath]);
  if (removeError && !/not found|does not exist/i.test(removeError.message)) {
    throw new Error(`FILE_REMOVE:${removeError.message}`);
  }
  const { error: markError } = await admin.rpc("mark_managed_file_deleted", { p_file_id: fileId });
  if (markError) throw new Error(`FILE_MARK_DELETED:${markError.message}`);
  const result = { fileId, deleted: true };
  await completeEffect(job, result);
  return result;
}

async function updateWebPushDelivery(deliveryId, values) {
  const { error } = await admin.from("notification_deliveries").update({ ...values, updated_at: new Date().toISOString() }).eq("id", deliveryId);
  if (error) throw new Error(`WEB_PUSH_DELIVERY_UPDATE:${error.message}`);
}

async function completeWebPushTerminal(job, result) {
  await completeEffect(job, result);
  return result;
}

async function suppressWebPush(job, delivery, code, subscription) {
  if (subscription && subscription.status === "active" && new Date(subscription.lease_expires_at).getTime() <= Date.now()) {
    const { error: expiryError } = await admin.from("web_push_subscriptions").update({
      status: "expired",
      encrypted_payload: null,
      revoked_at: new Date().toISOString(),
      revoked_reason: "lease_expired",
      updated_at: new Date().toISOString(),
    }).eq("id", subscription.id).eq("status", "active");
    if (expiryError) throw new Error(`WEB_PUSH_SUBSCRIPTION_EXPIRE:${expiryError.message}`);
  }
  await updateWebPushDelivery(delivery.id, {
    status: "suppressed",
    error_code: code,
    error_message: null,
    failed_at: null,
  });
  return completeWebPushTerminal(job, { deliveryId: delivery.id, suppressed: true, code });
}

async function recordWebPushIntegration(success, code = null) {
  const { error } = await admin.rpc("record_integration_outcome", {
    p_channel: "web_push",
    p_success: success,
    p_error_code: code,
  });
  if (error) throw new Error(`WEB_PUSH_INTEGRATION_OUTCOME:${error.message}`);
}

async function degradeWebPushIntegration(code) {
  const now = new Date();
  const degradedUntil = new Date(now.getTime() + 15 * 60 * 1000);
  const { error } = await admin.from("integration_channels").update({
    status: "degraded",
    degraded_until: degradedUntil.toISOString(),
    last_failure_at: now.toISOString(),
    last_error_code: code,
    updated_at: now.toISOString(),
  }).eq("channel", "web_push");
  if (error) throw new Error(`WEB_PUSH_INTEGRATION_DEGRADE:${error.message}`);
}

async function loadWebPushContext(deliveryId) {
  const { data: delivery, error: deliveryError } = await admin.from("notification_deliveries")
    .select("id,notification_id,recipient_id,subscription_id,status,attempt_count,expires_at")
    .eq("id", deliveryId).eq("channel", "web_push").maybeSingle();
  if (deliveryError || !delivery) throw Object.assign(new Error("Web Push delivery was not found."), {
    code: "WEB_PUSH_DELIVERY_NOT_FOUND",
    retryable: false,
  });
  const [{ data: notification, error: notificationError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    admin.from("notifications").select("id,recipient_id,archived_at").eq("id", delivery.notification_id).maybeSingle(),
    admin.from("web_push_subscriptions")
      .select("id,recipient_id,status,endpoint_fingerprint,encrypted_payload,encryption_key_version,locale,lease_expires_at")
      .eq("id", delivery.subscription_id).maybeSingle(),
  ]);
  if (notificationError || !notification) throw Object.assign(new Error("Web Push notification was not found."), {
    code: "WEB_PUSH_NOTIFICATION_NOT_FOUND",
    retryable: false,
  });
  if (subscriptionError || !subscription) throw Object.assign(new Error("Web Push subscription was not found."), {
    code: "WEB_PUSH_SUBSCRIPTION_NOT_FOUND",
    retryable: false,
  });
  if (notification.recipient_id !== delivery.recipient_id || subscription.recipient_id !== delivery.recipient_id) {
    throw Object.assign(new Error("Web Push delivery ownership did not match."), {
      code: "WEB_PUSH_OWNERSHIP_MISMATCH",
      retryable: false,
      configurationFailure: true,
    });
  }
  return { delivery, notification, subscription };
}

async function sendWebPush(job) {
  if (!(await reserveEffect(job))) return { deduplicated: true };
  const deliveryId = job.payload?.deliveryId;
  if (typeof deliveryId !== "string") throw Object.assign(new Error("Web Push job payload is invalid."), {
    code: "WEB_PUSH_JOB_INVALID",
    retryable: false,
  });
  const { delivery, notification, subscription } = await loadWebPushContext(deliveryId);
  if (delivery.status === "sent") return completeWebPushTerminal(job, { deliveryId, deduplicated: true, sent: true });
  if (["suppressed", "failed", "dead"].includes(delivery.status)) {
    return completeWebPushTerminal(job, { deliveryId, terminal: delivery.status });
  }
  if (notification.archived_at) return suppressWebPush(job, delivery, "NOTIFICATION_ARCHIVED", subscription);
  if (!delivery.expires_at || new Date(delivery.expires_at).getTime() <= Date.now()) {
    return suppressWebPush(job, delivery, "DELIVERY_EXPIRED", subscription);
  }
  if (subscription.status !== "active" || !subscription.encrypted_payload
    || new Date(subscription.lease_expires_at).getTime() <= Date.now()) {
    return suppressWebPush(job, delivery, "SUBSCRIPTION_INACTIVE", subscription);
  }

  const { data: enabled, error: enabledError } = await admin.rpc("notification_channel_enabled", { p_channel: "web_push" });
  if (enabledError) throw new Error(`WEB_PUSH_CHANNEL_CHECK:${enabledError.message}`);
  if (enabled !== true) return suppressWebPush(job, delivery, "CHANNEL_DISABLED", subscription);

  const encryptionVersion = Number(process.env.MATHIN_WEB_PUSH_ENCRYPTION_KEY_VERSION || "1");
  if (subscription.encryption_key_version !== encryptionVersion) {
    await degradeWebPushIntegration("WEB_PUSH_KEY_VERSION_MISMATCH");
    await updateWebPushDelivery(deliveryId, {
      status: "failed", error_code: "WEB_PUSH_KEY_VERSION_MISMATCH",
      error_message: null, failed_at: new Date().toISOString(),
    });
    return completeWebPushTerminal(job, { deliveryId, failed: true, code: "WEB_PUSH_KEY_VERSION_MISMATCH" });
  }

  let browserSubscription;
  try {
    browserSubscription = decryptWebPushSubscription(
      subscription.encrypted_payload,
      process.env.MATHIN_WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY || "",
    );
    browserSubscription = normalizeBrowserPushSubscription(
      browserSubscription,
      process.env.MATHIN_WEB_PUSH_ALLOWED_ORIGINS || "",
    );
    const actualFingerprint = fingerprintWebPushEndpoint(
      browserSubscription.endpoint,
      process.env.MATHIN_WEB_PUSH_FINGERPRINT_SECRET || "",
    );
    if (!constantTimeStringEqual(actualFingerprint, subscription.endpoint_fingerprint)) {
      throw Object.assign(new Error("Web Push endpoint fingerprint did not match."), {
        code: "WEB_PUSH_FINGERPRINT_MISMATCH",
        configurationFailure: true,
      });
    }
  } catch (error) {
    const code = String(error?.code || "WEB_PUSH_ENVELOPE_INVALID").slice(0, 100);
    await degradeWebPushIntegration(code);
    await updateWebPushDelivery(deliveryId, {
      status: "failed", error_code: code, error_message: null, failed_at: new Date().toISOString(),
    });
    return completeWebPushTerminal(job, { deliveryId, failed: true, code });
  }

  const ttl = webPushTtlSeconds(delivery.expires_at);
  if (ttl <= 0) return suppressWebPush(job, delivery, "DELIVERY_EXPIRED", subscription);
  const subject = process.env.MATHIN_WEB_PUSH_VAPID_SUBJECT || "";
  const publicKey = process.env.MATHIN_WEB_PUSH_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.MATHIN_WEB_PUSH_VAPID_SECRET || "";
  if (!/^(mailto:|https:\/\/)/.test(subject) || !publicKey || !privateKey) {
    await degradeWebPushIntegration("WEB_PUSH_VAPID_UNAVAILABLE");
    await updateWebPushDelivery(deliveryId, {
      status: "failed", error_code: "WEB_PUSH_VAPID_UNAVAILABLE",
      error_message: null, failed_at: new Date().toISOString(),
    });
    return completeWebPushTerminal(job, { deliveryId, failed: true, code: "WEB_PUSH_VAPID_UNAVAILABLE" });
  }

  await updateWebPushDelivery(deliveryId, {
    status: "sending",
    attempt_count: Number(delivery.attempt_count || 0) + 1,
    error_code: null,
    error_message: null,
  });
  try {
    const client = await webPushClient();
    const payload = buildGenericWebPushPayload({ deliveryId, locale: subscription.locale, expiresAt: delivery.expires_at });
    await client.sendNotification(browserSubscription, payload, {
      TTL: ttl,
      urgency: "normal",
      timeout: 10000,
      vapidDetails: { subject, publicKey, privateKey },
    });
  } catch (error) {
    if (error?.configurationFailure || error?.code === "WEB_PUSH_PROVIDER_UNAVAILABLE") {
      const code = String(error?.code || "WEB_PUSH_PROVIDER_UNAVAILABLE").slice(0, 100);
      await degradeWebPushIntegration(code);
      await updateWebPushDelivery(deliveryId, {
        status: "failed", error_code: code, error_message: null, failed_at: new Date().toISOString(),
      });
      return completeWebPushTerminal(job, { deliveryId, failed: true, code });
    }
    const failure = classifyWebPushFailure(error);
    const failedAt = new Date().toISOString();
    if (failure.kind === "gone") {
      const { error: goneError } = await admin.from("web_push_subscriptions").update({
        status: "gone", encrypted_payload: null, revoked_at: failedAt,
        revoked_reason: failure.code, last_failure_at: failedAt,
        last_error_code: failure.code, updated_at: failedAt,
      }).eq("id", subscription.id);
      if (goneError) throw new Error(`WEB_PUSH_SUBSCRIPTION_GONE:${goneError.message}`);
      await updateWebPushDelivery(deliveryId, {
        status: "suppressed", error_code: failure.code, error_message: null, failed_at: failedAt,
      });
      return completeWebPushTerminal(job, { deliveryId, suppressed: true, code: failure.code });
    }
    if (failure.kind === "terminal" || failure.kind === "auth") {
      if (failure.kind === "auth") await degradeWebPushIntegration(failure.code);
      else await recordWebPushIntegration(false, failure.code);
      await updateWebPushDelivery(deliveryId, {
        status: "failed", error_code: failure.code, error_message: null, failed_at: failedAt,
      });
      return completeWebPushTerminal(job, { deliveryId, failed: true, code: failure.code });
    }
    await recordWebPushIntegration(false, failure.code);
    await updateWebPushDelivery(deliveryId, {
      status: "queued", error_code: failure.code, error_message: null, failed_at: failedAt,
    });
    throw Object.assign(new Error(`Web Push request failed (${failure.code}).`), {
      code: failure.code,
      retryable: true,
      webPushRetryAfterSeconds: failure.retryAfterSeconds,
    });
  }
  const sentAt = new Date().toISOString();
  await updateWebPushDelivery(deliveryId, {
    status: "sent", sent_at: sentAt, failed_at: null, error_code: null, error_message: null,
  });
  const { error: subscriptionUpdateError } = await admin.from("web_push_subscriptions").update({
    last_success_at: sentAt, last_error_code: null, updated_at: sentAt,
  }).eq("id", subscription.id).eq("status", "active");
  if (subscriptionUpdateError) throw new Error(`WEB_PUSH_SUBSCRIPTION_SUCCESS:${subscriptionUpdateError.message}`);
  await recordWebPushIntegration(true);
  return completeWebPushTerminal(job, { deliveryId, sent: true });
}

async function processJob(job) {
  if (job.kind === "test.noop") {
    if (!(await reserveEffect(job))) return { deduplicated: true };
    const result = { noop: true };
    await completeEffect(job, result);
    return result;
  }
  if (job.kind === "file.verify") return verifyFile(job);
  if (job.kind === "file.cleanup") return cleanupFile(job);
  if (job.kind === "notification.web_push") return sendWebPush(job);
  if (job.kind.startsWith("notification.")) {
    throw Object.assign(new Error("External notification provider is not selected; channel is fail-closed."), {
      code: "CHANNEL_DISABLED",
      retryable: false,
    });
  }
  if (job.kind === "webhook.receive") {
    throw Object.assign(new Error("No inbound webhook domain adapter is selected."), {
      code: "PROVIDER_NOT_IMPLEMENTED",
      retryable: false,
    });
  }
  throw Object.assign(new Error(`Unsupported job kind: ${job.kind}`), { code: "UNKNOWN_JOB_KIND", retryable: false });
}

async function settle(job) {
  try {
    const result = await processJob(job);
    const { error } = await admin.rpc("complete_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_result: result,
    });
    if (error) throw new Error(`JOB_COMPLETE:${error.message}`);
    process.stdout.write(`${JSON.stringify({ event: "job.succeeded", jobId: job.job_id, kind: job.kind })}\n`);
  } catch (error) {
    const code = String(error?.code || String(error?.message || "JOB_FAILED").split(":", 1)[0]).slice(0, 100);
    const message = String(error?.message || "Job failed").slice(0, 4000);
    const failureRpc = job.kind === "notification.web_push" ? "fail_web_push_job" : "fail_job";
    const failureArgs = {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_error_code: code,
      p_error: message,
      p_retryable: error?.retryable !== false,
      ...(job.kind === "notification.web_push" ? {
        p_retry_after_seconds: Number.isInteger(error?.webPushRetryAfterSeconds)
          ? error.webPushRetryAfterSeconds
          : null,
      } : {}),
    };
    const { data: status, error: failError } = await admin.rpc(failureRpc, failureArgs);
    if (failError) throw new Error(`JOB_FAIL:${failError.message}; original=${message}`);
    if (job.kind === "notification.web_push" && status === "dead" && typeof job.payload?.deliveryId === "string") {
      await updateWebPushDelivery(job.payload.deliveryId, {
        status: "dead", error_code: code, error_message: null, failed_at: new Date().toISOString(),
      });
    }
    process.stderr.write(`${JSON.stringify({ event: "job.failed", jobId: job.job_id, kind: job.kind, status, code })}\n`);
  }
}

async function cycle() {
  const { error: heartbeatError } = await admin.rpc("heartbeat_job_worker", { p_worker_id: workerId, p_version: VERSION });
  if (heartbeatError) throw new Error(`WORKER_HEARTBEAT:${heartbeatError.message}`);
  const { error: cleanupError } = await admin.rpc("enqueue_file_cleanup_jobs", { p_limit: batchSize });
  if (cleanupError) throw new Error(`CLEANUP_ENQUEUE:${cleanupError.message}`);
  const { error: importCleanupError } = await admin.rpc("purge_expired_data_import_payloads", { p_limit: batchSize * 50 });
  if (importCleanupError) throw new Error(`IMPORT_CLEANUP:${importCleanupError.message}`);
  const { data: jobs, error: claimError } = await admin.rpc("claim_jobs", {
    p_worker_id: workerId,
    p_limit: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (claimError) throw new Error(`JOB_CLAIM:${claimError.message}`);
  for (const job of jobs || []) await settle(job);
  return jobs?.length || 0;
}

process.stdout.write(`${JSON.stringify({ event: "worker.started", workerId, version: VERSION, once })}\n`);
do {
  await cycle();
  if (!once) await new Promise((resolve) => setTimeout(resolve, pollMs));
} while (!once);
