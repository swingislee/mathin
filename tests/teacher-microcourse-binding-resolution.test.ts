import { describe, expect, it } from "vitest";
import {
  bindingObjectLookupRevisionIds,
  resolveTeacherMicrocourseBindingDescriptors,
} from "@/features/teacher-microcourses/binding-resolution";

describe("teacher microcourse binding resolution", () => {
  it("uses the pinned object kind and digest for a legacy null-kind source runtime binding", () => {
    const revisionId = "00000000-0000-4000-8000-000000000001";
    const packageHash = "b".repeat(64);
    const bindings = [{
      bindingKey: "a".repeat(64),
      assetRevisionId: revisionId,
      kind: null,
      storagePath: `packages/${packageHash}`,
    }];

    expect(bindingObjectLookupRevisionIds(bindings)).toEqual([revisionId]);
    expect(resolveTeacherMicrocourseBindingDescriptors(bindings, new Map([[revisionId, {
      sha256: packageHash,
      storagePath: `packages/${packageHash}`,
      kind: "h5",
    }]]))).toEqual([{
      bindingKey: "a".repeat(64),
      storagePath: `packages/${packageHash}`,
      objectHash: packageHash,
      kind: "h5",
    }]);
  });

  it("keeps ordinary signed resources on their existing path without an object lookup", () => {
    const binding = {
      bindingKey: "c".repeat(64),
      assetRevisionId: "00000000-0000-4000-8000-000000000002",
      kind: "image",
      storagePath: "sha256/cc/object",
    };

    expect(bindingObjectLookupRevisionIds([binding])).toEqual([]);
    expect(resolveTeacherMicrocourseBindingDescriptors([binding], new Map())).toEqual([{
      bindingKey: binding.bindingKey,
      storagePath: binding.storagePath,
      objectHash: binding.bindingKey,
      kind: "image",
    }]);
  });
});
