"use server";

import { headers } from "next/headers";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { actionError } from "@/lib/action-result";
import { createClient } from "@/lib/supabase/server";
import type {
  RegisterWebPushInput,
  WebPushCapability,
  WebPushDevice,
} from "./web-push-contract";
import { WEB_PUSH_VAPID_KEY_VERSION } from "./web-push-contract";
import {
  encryptWebPushSubscription,
  fingerprintWebPushEndpoint,
  normalizeBrowserPushSubscription,
  validateWebPushEndpoint,
} from "./web-push-runtime.mjs";

const WEB_PUSH_CODES = [
  "UNAUTHENTICATED",
  "VALIDATION",
  "CSRF_ORIGIN",
  "WEB_PUSH_NOT_IN_ROLLOUT",
  "WEB_PUSH_CHANNEL_DISABLED",
  "WEB_PUSH_DEVICE_LIMIT",
  "WEB_PUSH_DEVICE_NOT_FOUND",
  "WEB_PUSH_ENDPOINT_INVALID",
  "WEB_PUSH_ORIGIN_NOT_ALLOWED",
  "WEB_PUSH_ALLOWED_ORIGIN_INVALID",
  "WEB_PUSH_SECRETS_UNAVAILABLE",
  "RATE_LIMITED",
  "NOT_FOUND",
] as const;

const deviceModeSchema = z.enum(["shared", "personal"]);
const localeSchema = z.enum(["zh", "en"]);
const familySchema = z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const registerSchema = z.object({
  subscription: z.object({
    endpoint: z.string().min(20).max(2048),
    expirationTime: z.number().finite().positive().nullable(),
    keys: z.object({
      p256dh: z.string().min(40).max(200),
      auth: z.string().min(12).max(100),
    }),
  }),
  deviceLabel: z.string().trim().min(1).max(80),
  deviceMode: deviceModeSchema,
  browserFamily: familySchema,
  platformFamily: familySchema,
  locale: localeSchema,
});
const endpointSchema = z.string().min(20).max(2048);
const uuidSchema = z.uuid();

const capabilitySchema = z.object({
  roleEligible: z.boolean(),
  rolloutEligible: z.boolean(),
  featureEnabled: z.boolean(),
  channelEnabled: z.boolean(),
  activeDeviceCount: z.number().int().nonnegative(),
  maxDevices: z.number().int().positive(),
});

const deviceRowSchema = z.object({
  id: z.uuid(),
  device_label: z.string(),
  device_mode: deviceModeSchema,
  browser_family: z.string(),
  platform_family: z.string(),
  locale: localeSchema,
  status: z.enum(["active", "revoked", "expired", "gone"]),
  last_confirmed_at: z.string(),
  lease_expires_at: z.string(),
  last_success_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
});

interface RpcError {
  message: string;
}

type UntypedRpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

async function callRpc(
  supabase: Awaited<ReturnType<typeof createClient>>,
  name: string,
  args?: Record<string, unknown>,
) {
  return (supabase.rpc as unknown as UntypedRpc)(name, args);
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return supabase;
}

async function assertSameOrigin() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || requestHeaders.get("host");
  if (!origin || !host) throw new Error("CSRF_ORIGIN");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("CSRF_ORIGIN");
  }
  if (originHost.toLowerCase() !== host.toLowerCase()) throw new Error("CSRF_ORIGIN");
}

function allowedOrigins() {
  return process.env.MATHIN_WEB_PUSH_ALLOWED_ORIGINS || "";
}

function encryptionKey() {
  return process.env.MATHIN_WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY || "";
}

function fingerprintSecret() {
  return process.env.MATHIN_WEB_PUSH_FINGERPRINT_SECRET || "";
}

function encryptionKeyVersion() {
  const value = Number(process.env.MATHIN_WEB_PUSH_ENCRYPTION_KEY_VERSION || "1");
  if (!Number.isInteger(value) || value < 1 || value > 32767) throw new Error("WEB_PUSH_SECRETS_UNAVAILABLE");
  return value;
}

function vapidPublicKey() {
  const value = process.env.MATHIN_WEB_PUSH_VAPID_PUBLIC_KEY || "";
  return /^[A-Za-z0-9_-]{80,120}$/.test(value) ? value : null;
}

function mapDevice(row: z.infer<typeof deviceRowSchema>): WebPushDevice {
  return {
    id: row.id,
    deviceLabel: row.device_label,
    deviceMode: row.device_mode,
    browserFamily: row.browser_family,
    platformFamily: row.platform_family,
    locale: row.locale,
    status: row.status,
    lastConfirmedAt: row.last_confirmed_at,
    leaseExpiresAt: row.lease_expires_at,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    lastErrorCode: row.last_error_code,
  };
}

export async function getMyWebPushSnapshotAction(): Promise<ActionResult<{
  capability: WebPushCapability;
  devices: WebPushDevice[];
}>> {
  try {
    const supabase = await authenticatedClient();
    const [capabilityResult, devicesResult] = await Promise.all([
      callRpc(supabase, "get_my_web_push_capability"),
      callRpc(supabase, "get_my_web_push_devices"),
    ]);
    if (capabilityResult.error) throw new Error(capabilityResult.error.message);
    if (devicesResult.error) throw new Error(devicesResult.error.message);
    const capabilityValue = capabilitySchema.parse(capabilityResult.data);
    const devices = z.array(deviceRowSchema).parse(devicesResult.data ?? []).map(mapDevice);
    return {
      ok: true,
      data: {
        capability: {
          ...capabilityValue,
          vapidPublicKey: vapidPublicKey(),
          secureContextRequired: true,
        },
        devices,
      },
    };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}

export async function registerMyWebPushSubscriptionAction(
  input: RegisterWebPushInput,
): Promise<ActionResult<{ subscriptionId: string }>> {
  try {
    await assertSameOrigin();
    const value = registerSchema.parse(input);
    const subscription = normalizeBrowserPushSubscription(value.subscription, allowedOrigins());
    const endpointFingerprint = fingerprintWebPushEndpoint(subscription.endpoint, fingerprintSecret());
    const encryptedPayload = encryptWebPushSubscription(subscription, encryptionKey());
    const supabase = await authenticatedClient();
    const { data, error } = await callRpc(supabase, "register_my_web_push_subscription", {
      p_endpoint_fingerprint: endpointFingerprint,
      p_encrypted_payload: encryptedPayload,
      p_encryption_key_version: encryptionKeyVersion(),
      p_vapid_key_version: WEB_PUSH_VAPID_KEY_VERSION,
      p_device_label: value.deviceLabel,
      p_device_mode: value.deviceMode,
      p_browser_family: value.browserFamily,
      p_platform_family: value.platformFamily,
      p_locale: value.locale,
    });
    if (error) throw new Error(error.message);
    const subscriptionId = uuidSchema.parse(data);
    return { ok: true, data: { subscriptionId } };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}

export async function reconcileMyWebPushSubscriptionAction(
  endpoint: string,
): Promise<ActionResult<{ subscriptionId: string | null }>> {
  try {
    await assertSameOrigin();
    const safeEndpoint = validateWebPushEndpoint(endpointSchema.parse(endpoint), allowedOrigins());
    const endpointFingerprint = fingerprintWebPushEndpoint(safeEndpoint, fingerprintSecret());
    const supabase = await authenticatedClient();
    const { data, error } = await callRpc(supabase, "reconcile_my_web_push_subscription", {
      p_endpoint_fingerprint: endpointFingerprint,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { subscriptionId: data === null ? null : uuidSchema.parse(data) } };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}

export async function revokeMyWebPushSubscriptionAction(
  subscriptionId: string,
): Promise<ActionResult<{ revoked: boolean }>> {
  try {
    await assertSameOrigin();
    const id = uuidSchema.parse(subscriptionId);
    const supabase = await authenticatedClient();
    const { data, error } = await callRpc(supabase, "revoke_my_web_push_subscription", {
      p_subscription_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { revoked: data === true } };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}

export async function revokeAllMyWebPushSubscriptionsAction(): Promise<ActionResult<{ revoked: number }>> {
  try {
    await assertSameOrigin();
    const supabase = await authenticatedClient();
    const { data, error } = await callRpc(supabase, "revoke_all_my_web_push_subscriptions");
    if (error) throw new Error(error.message);
    return { ok: true, data: { revoked: z.number().int().nonnegative().parse(data) } };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}

export async function sendMyWebPushTestAction(
  subscriptionId: string,
): Promise<ActionResult<{ eventId: string }>> {
  try {
    await assertSameOrigin();
    const id = uuidSchema.parse(subscriptionId);
    const supabase = await authenticatedClient();
    const { data, error } = await callRpc(supabase, "send_my_web_push_test", {
      p_subscription_id: id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, data: { eventId: uuidSchema.parse(data) } };
  } catch (error) {
    return actionError(error, WEB_PUSH_CODES);
  }
}
