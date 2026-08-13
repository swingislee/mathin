/**
 * Storage API rejects some raw Unicode object keys. Keep logical filenames
 * intact in manifests while storing unsafe path segments under the same
 * deterministic encoding used by the H5 runtime shim.
 */
function h5StorageSegment(segment) {
  let logical = segment;
  try { logical = decodeURIComponent(segment); } catch {}
  return /[^\x20-\x7E]|[:%]/.test(logical)
    ? `u_${encodeURIComponent(logical).replaceAll("%", "_")}`
    : logical;
}

export function h5StoragePath(packageHash, packagePath) {
  return `packages/${packageHash}/${packagePath.split("/").map(h5StorageSegment).join("/")}`;
}
