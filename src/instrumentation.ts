import type { Instrumentation } from "next";

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000);
}

function digestOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("digest" in error)) return undefined;
  const digest = (error as Error & { digest?: unknown }).digest;
  return typeof digest === "string" ? digest.slice(0, 200) : undefined;
}

function reportUrl(): URL | null {
  const raw = process.env.MATHIN_ERROR_REPORT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && local) ? url : null;
  } catch {
    return null;
  }
}

export async function register(): Promise<void> {
  if (process.env.MATHIN_ERROR_REPORT_URL && !reportUrl()) {
    console.error(JSON.stringify({
      level: "error",
      event: "observability.config_invalid",
      at: new Date().toISOString(),
      message: "MATHIN_ERROR_REPORT_URL must be HTTPS in production",
    }));
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const payload = {
    level: "error",
    event: "request.error",
    at: new Date().toISOString(),
    message: messageOf(error),
    digest: digestOf(error),
    path: request.path.split("?", 1)[0],
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    environment: process.env.NODE_ENV,
    release: process.env.MATHIN_RELEASE?.slice(0, 100),
  };
  console.error(JSON.stringify(payload));

  const url = reportUrl();
  if (!url) return;
  try {
    const token = process.env.MATHIN_ERROR_REPORT_TOKEN;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (reportError) {
    console.error(JSON.stringify({
      level: "error",
      event: "observability.delivery_failed",
      at: new Date().toISOString(),
      message: messageOf(reportError),
    }));
  }
};
