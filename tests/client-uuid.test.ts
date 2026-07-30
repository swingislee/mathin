import { describe, expect, it, vi } from "vitest";
import { newId } from "@/lib/uuid";

describe("client UUID compatibility", () => {
  it("uses native randomUUID when the browser exposes it", () => {
    const nativeId = "123e4567-e89b-42d3-a456-426614174000";
    const getRandomValues = vi.fn();

    expect(newId({ randomUUID: () => nativeId, getRandomValues })).toBe(nativeId);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("generates an RFC 4122 v4 UUID when randomUUID is unavailable", () => {
    const source = Uint8Array.from([0, 1, 2, 3, 4, 5, 255, 7, 255, 9, 10, 11, 12, 13, 14, 15]);
    const id = newId({
      getRandomValues: (target) => {
        target.set(source);
        return target;
      },
    });

    expect(id).toBe("00010203-0405-4f07-bf09-0a0b0c0d0e0f");
  });
});
