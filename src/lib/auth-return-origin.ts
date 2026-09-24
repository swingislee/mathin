import "server-only";

/** Next 的 request.url 可能使用绑定监听地址；代理覆盖 Host / X-Forwarded-* 后还原外部源。 */
export function requestPublicOrigin(request: Request): string | null {
  try {
    const fallback = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? fallback.host;
    const protocol = request.headers.get("x-forwarded-proto") ?? fallback.protocol.slice(0, -1);
    if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(host) || !["http", "https"].includes(protocol)) return null;
    return new URL(`${protocol}://${host}`).origin;
  } catch { return null; }
}

export function authReturnOrigin(request: Request): string {
  const observed = requestPublicOrigin(request);
  const configured = new URL(process.env.NEXT_PUBLIC_SITE_URL || request.url).origin;
  if (observed === configured) return configured;
  if (process.env.NODE_ENV !== "production" && observed) {
    const url = new URL(observed);
    if (url.protocol === "http:" && url.port === "3130" && ["127.0.0.1", "localhost", "192.168.5.213"].includes(url.hostname)) return observed;
  }
  return configured;
}
