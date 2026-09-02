export type SourceRuntimeSandboxResource = string | Blob;

/**
 * A sandboxed source-runtime frame has an opaque origin, so it cannot read a
 * blob URL created by the parent classroom document. Structured-clone the
 * underlying Blob instead; the frame's delivery bridge creates its own local
 * URL without weakening the iframe sandbox.
 */
export async function prepareSourceRuntimeResourcesForSandbox(
  resources: Readonly<Record<string, SourceRuntimeSandboxResource>>,
  signal?: AbortSignal,
): Promise<Record<string, SourceRuntimeSandboxResource>> {
  const entries = await Promise.all(Object.entries(resources).map(async ([resourceId, url]) => {
    if (typeof url !== "string" || !url.startsWith("blob:")) return [resourceId, url] as const;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("SOURCE_RUNTIME_BLOB_UNAVAILABLE");
    return [resourceId, await response.blob()] as const;
  }));
  return Object.fromEntries(entries);
}
