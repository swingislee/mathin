type WebCrypto = {
  getRandomValues: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

/** 局域网 HTTP 是非安全上下文，没有 crypto.randomUUID；用 getRandomValues 兜底生成 v4。 */
export function newId(cryptoApi: WebCrypto = globalThis.crypto): string {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
