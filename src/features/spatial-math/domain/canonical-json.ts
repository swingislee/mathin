type JsonPrimitive = null | boolean | number | string;

function serializeCanonical(value: unknown, ancestors: Set<object>, path: string): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number at ${path}`);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`non-JSON value at ${path}: ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError(`cyclic value at ${path}`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((item, index) => serializeCanonical(item, ancestors, `${path}[${index}]`))
        .join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`non-plain object at ${path}`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`symbol property at ${path}`);
    }

    const record = value as Record<string, JsonPrimitive | object>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], ancestors, `${path}.${key}`)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Sorts object keys, preserves array order and rejects every non-JSON value. */
export function canonicalJsonStringify(value: unknown): string {
  return serializeCanonical(value, new Set(), "$");
}

export async function canonicalSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonStringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
