export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("REQUEST_BODY_TOO_LARGE");
    this.name = "RequestBodyTooLargeError";
  }
}

/** Limit incoming bytes before decoding; Content-Length is only an early hint. */
export async function readLimitedRequestText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    await request.body?.cancel().catch(() => {});
    throw new RequestBodyTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const fragments: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      fragments.push(decoder.decode(value, { stream: true }));
    }
    fragments.push(decoder.decode());
    return fragments.join("");
  } finally {
    reader.releaseLock();
  }
}
