import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const VERSION = "r1-2.1";
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

async function processJob(job) {
  if (job.kind === "test.noop") {
    if (!(await reserveEffect(job))) return { deduplicated: true };
    const result = { noop: true };
    await completeEffect(job, result);
    return result;
  }
  if (job.kind === "file.verify") return verifyFile(job);
  if (job.kind === "file.cleanup") return cleanupFile(job);
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
    const { data: status, error: failError } = await admin.rpc("fail_job", {
      p_job_id: job.job_id,
      p_lease_token: job.lease_token,
      p_error_code: code,
      p_error: message,
      p_retryable: error?.retryable !== false,
    });
    if (failError) throw new Error(`JOB_FAIL:${failError.message}; original=${message}`);
    process.stderr.write(`${JSON.stringify({ event: "job.failed", jobId: job.job_id, kind: job.kind, status, code })}\n`);
  }
}

async function cycle() {
  const { error: heartbeatError } = await admin.rpc("heartbeat_job_worker", { p_worker_id: workerId, p_version: VERSION });
  if (heartbeatError) throw new Error(`WORKER_HEARTBEAT:${heartbeatError.message}`);
  const { error: cleanupError } = await admin.rpc("enqueue_file_cleanup_jobs", { p_limit: batchSize });
  if (cleanupError) throw new Error(`CLEANUP_ENQUEUE:${cleanupError.message}`);
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
