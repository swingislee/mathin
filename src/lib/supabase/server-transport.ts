import "server-only";

/** 同机网关只改变服务端传输；SDK 的公开 URL 继续决定 Cookie、回调和资源链接。 */
export function createSupabaseServerFetch(
  publicUrl: string,
  serverUrl = process.env.SUPABASE_SERVER_URL,
  transport: typeof fetch = fetch,
): typeof fetch | undefined {
  if (!serverUrl) return undefined;
  const destination = new URL(serverUrl);
  if (destination.protocol !== "http:" || destination.hostname !== "127.0.0.1"
    || !destination.port || destination.pathname !== "/" || destination.search || destination.hash
    || destination.username || destination.password) {
    throw new Error("SUPABASE_SERVER_URL must be an HTTP loopback gateway origin with a port");
  }
  const canonical = new URL(publicUrl);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const isDataRequest = url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/rest/v1/");
    if (url.origin !== canonical.origin || !isDataRequest) return transport(input, init);
    const target = new URL(url.pathname + url.search, destination);
    return transport(input instanceof Request ? new Request(target, input) : target, init);
  };
}
