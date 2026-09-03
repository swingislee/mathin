export interface WebPushFailureClassification {
  kind: "gone" | "terminal" | "auth" | "retry";
  code: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
}

export function parseRetryAfterSeconds(value: unknown, now?: number): number | null;
export function classifyWebPushFailure(error: unknown, now?: number): WebPushFailureClassification;
export function buildGenericWebPushPayload(input: {
  deliveryId: string;
  locale: "zh" | "en";
  expiresAt: string;
}): string;
export function webPushTtlSeconds(expiresAt: string, now?: number): number;
