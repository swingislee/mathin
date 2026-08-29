export interface TeacherMicrocourseBindingDescriptor {
  bindingKey: string;
  assetRevisionId: string;
  kind: string | null;
  storagePath: string | null;
}

export interface TeacherMicrocourseAssetObjectDescriptor {
  sha256: string;
  storagePath: string;
  kind: string;
}

export interface ResolvedTeacherMicrocourseBindingDescriptor {
  bindingKey: string;
  storagePath: string | null;
  objectHash: string | null;
  kind: string | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * A binding's usage kind is not an authoritative description of its stored
 * object. Legacy and source-runtime bindings can legitimately have a null
 * usage kind while their pinned object is an immutable H5 package.
 */
export function bindingObjectLookupRevisionIds(
  bindings: readonly TeacherMicrocourseBindingDescriptor[],
): string[] {
  return [...new Set(bindings
    .filter((binding) => !binding.storagePath || !binding.kind || binding.kind === "h5")
    .map((binding) => binding.assetRevisionId))];
}

export function resolveTeacherMicrocourseBindingDescriptors(
  bindings: readonly TeacherMicrocourseBindingDescriptor[],
  objectByRevision: ReadonlyMap<string, TeacherMicrocourseAssetObjectDescriptor>,
): ResolvedTeacherMicrocourseBindingDescriptor[] {
  return bindings.map((binding) => {
    const object = objectByRevision.get(binding.assetRevisionId);
    const objectIsH5 = object?.kind === "h5";
    return {
      bindingKey: binding.bindingKey,
      storagePath: binding.storagePath ?? object?.storagePath ?? null,
      objectHash: object?.sha256 ?? (SHA256_HEX.test(binding.bindingKey) ? binding.bindingKey : null),
      kind: objectIsH5 ? "h5" : binding.kind ?? object?.kind ?? null,
    };
  });
}
