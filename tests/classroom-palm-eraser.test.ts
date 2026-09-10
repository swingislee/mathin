import { describe, expect, it } from "vitest";
import { calibratePalmEraser, contactSize, isPalmContact, palmEraserDiameter, parsePalmEraserSettings } from "@/features/classroom/input/palm-eraser";

const samples = (size: number) => Array.from({ length: 10 }, () => ({ width: size, height: size }));

describe("device-calibrated palm eraser", () => {
  it("requires distinguishable contact areas and keeps unsupported devices disabled", () => {
    expect(calibratePalmEraser(samples(1), samples(1), "screen").error).toBe("unavailable");
    expect(calibratePalmEraser(samples(10), [...samples(10), ...samples(10)], "screen").error).toBe("indistinct");
    expect(calibratePalmEraser(samples(10), samples(15), "screen").error).toBe("indistinct");
    expect(parsePalmEraserSettings({ enabled: true, profile: null }).enabled).toBe(false);
    expect(contactSize({ width: Infinity, height: 60 })).toBe(0);
    expect(contactSize({ width: -60, height: -60 })).toBe(0);
    expect(contactSize({ width: 2000, height: 2000 })).toBe(0);
  });

  it("calibrates each contact independently and tolerates occasional sample noise", () => {
    const { profile, error } = calibratePalmEraser([...samples(10), { width: 200, height: 200 }], [...samples(60), { width: 1, height: 1 }], "1920x1080:1");
    expect(error).toBeNull();
    expect(profile).toMatchObject({ fingerSize: 10, palmSize: 60, threshold: 35 });
    expect(isPalmContact({ width: 10, height: 10 }, profile!.threshold)).toBe(false);
    expect(isPalmContact({ width: 50, height: 70 }, profile!.threshold)).toBe(true);
    expect(parsePalmEraserSettings({ enabled: true, profile })).toEqual({ enabled: true, profile });
    expect(parsePalmEraserSettings({ enabled: true, profile: { ...profile, threshold: 5 } }).enabled).toBe(false);
    expect(parsePalmEraserSettings({ enabled: true, profile: { ...profile, version: 2 } }).enabled).toBe(false);
  });

  it("limits the eraser footprint on small and large displays", () => {
    expect(palmEraserDiameter({ width: 20, height: 25 })).toBe(44);
    expect(palmEraserDiameter({ width: 60, height: 80 })).toBe(92);
    expect(palmEraserDiameter({ width: 500, height: 600 })).toBe(220);
  });
});
