import { describe, expect, it } from "vitest";

import { reuseCoursewareObjectUrls } from "../src/features/courseware-preview/client";

describe("courseware preview object URL reuse", () => {
  it("keeps one signed URL identity for the same immutable object path", () => {
    const known = new Map<string, string>();
    const first = "https://supabase.mathin.club/storage/v1/object/sign/cw-objects/sha256/aa/hash?token=first";
    const second = "https://supabase.mathin.club/storage/v1/object/sign/cw-objects/sha256/aa/hash?token=second";

    expect(reuseCoursewareObjectUrls({ first, runtime: "/api/cw-h5/packages/x/index.html" }, known))
      .toEqual({ first, runtime: "/api/cw-h5/packages/x/index.html" });
    expect(reuseCoursewareObjectUrls({ second }, known)).toEqual({ second: first });
  });
});
