export type SourceRuntimeSandboxResource = string | Blob;

/**
 * Source-runtime frames intentionally use an opaque sandbox origin. Blob URLs
 * created by the host document are therefore unreadable inside the frame.
 * Clone the underlying Blob through postMessage and let the frame create a
 * local object URL without weakening the sandbox with allow-same-origin.
 */
export async function prepareSourceRuntimeResourcesForSandbox(
  resources: Readonly<Record<string, SourceRuntimeSandboxResource>>,
  signal?: AbortSignal,
): Promise<Record<string, SourceRuntimeSandboxResource>> {
  const entries = await Promise.all(Object.entries(resources).map(async ([resourceId, value]) => {
    if (typeof value !== "string" || !value.startsWith("blob:")) return [resourceId, value] as const;
    const response = await fetch(value, { signal });
    if (!response.ok) throw new Error("SOURCE_RUNTIME_BLOB_UNAVAILABLE");
    return [resourceId, await response.blob()] as const;
  }));
  return Object.fromEntries(entries);
}
