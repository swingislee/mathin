import type { BrowserPushSubscriptionInput } from "./web-push-contract";

export function validateWebPushEndpoint(endpoint: string, allowedOrigins: string | string[]): string;
export function normalizeBrowserPushSubscription(value: unknown, allowedOrigins: string | string[]): BrowserPushSubscriptionInput;
export function fingerprintWebPushEndpoint(endpoint: string, fingerprintSecret: string): string;
export function encryptWebPushSubscription(subscription: BrowserPushSubscriptionInput, keyBase64: string): string;
export function decryptWebPushSubscription(envelopeBase64: string, keyBase64: string): BrowserPushSubscriptionInput;
export function constantTimeStringEqual(left: string, right: string): boolean;
