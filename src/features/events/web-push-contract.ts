export const WEB_PUSH_SERVICE_WORKER_PATH = "/notification-sw.js";
export const WEB_PUSH_SERVICE_WORKER_SCOPE = "/";
export const WEB_PUSH_MAX_DEVICES = 5;
export const WEB_PUSH_VAPID_KEY_VERSION = 1;
export {
  detectBrowserFamily,
  detectPlatformFamily,
  isSupportedWebPushDevice,
  isSupportedWebPushUserAgent,
} from "./web-push-support.mjs";

export type WebPushDeviceMode = "shared" | "personal";
export type WebPushSubscriptionStatus = "active" | "revoked" | "expired" | "gone";

export interface WebPushCapability {
  roleEligible: boolean;
  rolloutEligible: boolean;
  featureEnabled: boolean;
  channelEnabled: boolean;
  activeDeviceCount: number;
  maxDevices: number;
  vapidPublicKey: string | null;
  secureContextRequired: boolean;
}
export interface WebPushDevice {
  id: string;
  deviceLabel: string;
  deviceMode: WebPushDeviceMode;
  browserFamily: string;
  platformFamily: string;
  locale: "zh" | "en";
  status: WebPushSubscriptionStatus;
  lastConfirmedAt: string;
  leaseExpiresAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
}

export interface BrowserPushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface RegisterWebPushInput {
  subscription: BrowserPushSubscriptionInput;
  deviceLabel: string;
  deviceMode: WebPushDeviceMode;
  browserFamily: string;
  platformFamily: string;
  locale: "zh" | "en";
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function serializePushSubscription(subscription: PushSubscription): BrowserPushSubscriptionInput {
  const value = subscription.toJSON();
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error("WEB_PUSH_SUBSCRIPTION_INCOMPLETE");
  }
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime ?? null,
    keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
  };
}

export function defaultWebPushDeviceLabel(browserFamily: string, platformFamily: string): string {
  return `${browserFamily} · ${platformFamily}`.slice(0, 80);
}
