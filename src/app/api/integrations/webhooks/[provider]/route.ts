import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function response(status: number, code: string) {
  return NextResponse.json({ ok: false, code }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDER_PATTERN.test(provider)) return response(404, "NOT_FOUND");

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_BODY_BYTES) return response(413, "PAYLOAD_TOO_LARGE");

  const eventId = request.headers.get("x-mathin-event-id")?.trim();
  const timestampHeader = request.headers.get("x-mathin-timestamp")?.trim();
  const signatureHeader = request.headers.get("x-mathin-signature")?.trim().toLowerCase();
  const signature = signatureHeader?.startsWith("sha256=") ? signatureHeader.slice(7) : signatureHeader;
  if (!eventId || eventId.length > 200 || !timestampHeader || !signature || !DIGEST_PATTERN.test(signature)) {
    return response(400, "INVALID_WEBHOOK_HEADERS");
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isInteger(timestampSeconds)) return response(400, "INVALID_WEBHOOK_TIMESTAMP");
  const eventDate = new Date(timestampSeconds * 1000);
  if (Number.isNaN(eventDate.getTime()) || Math.abs(Date.now() - eventDate.getTime()) > 300_000) {
    return response(400, "WEBHOOK_TIMESTAMP_OUT_OF_RANGE");
  }

  const admin = createAdminClient();
  const { data: channel, error: channelError } = await admin
    .from("integration_channels")
    .select("provider_key,status,secret_ref,degraded_until")
    .eq("channel", "webhook")
    .eq("provider_key", provider)
    .maybeSingle<{ provider_key: string; status: string; secret_ref: string | null; degraded_until: string | null }>();
  if (channelError || !channel || channel.status !== "enabled" || !channel.secret_ref) {
    return response(404, "CHANNEL_DISABLED");
  }
  if (channel.degraded_until && new Date(channel.degraded_until).getTime() > Date.now()) {
    return response(503, "PROVIDER_DEGRADED");
  }
  const secret = process.env[channel.secret_ref];
  if (!secret) return response(503, "PROVIDER_SECRET_UNAVAILABLE");

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return response(413, "PAYLOAD_TOO_LARGE");
  const expected = createHmac("sha256", secret).update(`${timestampHeader}.${eventId}.${body}`, "utf8").digest();
  const supplied = Buffer.from(signature, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return response(401, "INVALID_WEBHOOK_SIGNATURE");
  }

  let payload: unknown;
  try {
    payload = body.length === 0 ? {} : JSON.parse(body);
  } catch {
    return response(400, "INVALID_JSON");
  }
  const payloadDigest = createHash("sha256").update(body, "utf8").digest("hex");
  const { data: receiptId, error: receiptError } = await admin.rpc("accept_webhook_receipt", {
    p_provider_key: provider,
    p_external_event_id: eventId,
    p_event_timestamp: eventDate.toISOString(),
    p_signature_digest: signature,
    p_payload_digest: payloadDigest,
    p_payload: payload,
  });
  if (receiptError?.message.includes("WEBHOOK_REPLAY")) return response(409, "WEBHOOK_REPLAY");
  if (receiptError?.message.includes("CHANNEL_DISABLED")) return response(404, "CHANNEL_DISABLED");
  if (receiptError) return response(503, "WEBHOOK_ACCEPT_FAILED");
  return NextResponse.json({ ok: true, receiptId }, { status: 202 });
}
