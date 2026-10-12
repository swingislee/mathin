import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultMiniappSettings, isMiniappSettings } from "../contracts/participant-api/miniapp-settings";
import { miniappSettingsSchema } from "../src/features/school/miniapp-settings/contract";

vi.mock("server-only", () => ({}));
vi.mock("@/features/parent-portal/server", () => ({ PortalError: class extends Error { constructor(public code: string) { super(code); } } }));
import { prepareMiniappImage, prepareMiniappQrImage } from "../src/features/school/miniapp-settings/images";
import { publishedImageResponse } from "../src/features/participant-portal/published-image";

describe("Mini Program publication boundaries", () => {
  it("preserves stable grade identities and rejects executable or external configuration", () => {
    const config = defaultMiniappSettings();
    expect(miniappSettingsSchema.safeParse(config).success).toBe(true);
    expect(isMiniappSettings(config)).toBe(true);
    expect(miniappSettingsSchema.safeParse({ ...config, brand: { ...config.brand, image: "https://outside.invalid/a.png" } }).success).toBe(false);
    const changed = structuredClone(config); changed.stages[0].stages[0].stageNumber = 6;
    expect(miniappSettingsSchema.safeParse(changed).success).toBe(false);
    expect(miniappSettingsSchema.safeParse({ ...config, home: [{ ...config.home[0], action: "javascript:alert(1)" }] }).success).toBe(false);
    expect(isMiniappSettings({ ...config, accountGroups: [{}] })).toBe(false);
  });
  it("decodes, resizes and strips uploaded image metadata before storage", async () => {
    const source = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#efdca0" } }).withMetadata().png().toBuffer();
    const result = await prepareMiniappImage(new File([new Uint8Array(source)], "photo.png", { type: "image/png" }));
    const display = await sharp(result.display).metadata(), thumb = await sharp(result.thumbnail).metadata();
    expect(display.format).toBe("webp"); expect(display.width).toBe(1600); expect(display.exif).toBeUndefined();
    expect(thumb.width).toBe(480); expect(result.display.byteLength).toBeLessThan(2 * 1024 * 1024);
    await expect(prepareMiniappImage(new File(["not a photo"], "photo.png", { type: "image/png" }))).rejects.toThrow("VALIDATION");
  });
  it("preserves QR pixels in lossless output and rejects undecodable QR uploads", async () => {
    const pixels = new Uint8Array(128 * 128 * 3).map((_, i) => ((Math.floor(i / 3) % 128 < 64) === (Math.floor(i / 384) < 64)) ? 0 : 255);
    const source = await sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } }).withMetadata().png().toBuffer();
    const result = await prepareMiniappQrImage(new File([new Uint8Array(source)], "qr.png", { type: "image/png" }));
    const decoded = await sharp(result.display).raw().toBuffer();
    expect(new Uint8Array(decoded)).toEqual(pixels);
    expect((await sharp(result.display).metadata()).exif).toBeUndefined();
    await expect(prepareMiniappQrImage(new File(["invalid"], "qr.png", { type: "image/png" }))).rejects.toThrow("VALIDATION");
  });
  it("rechecks visibility before returning a cached image or a 304 response", async () => {
    const download = vi.fn(async () => ({ data: new Blob(["image bytes"]), error: null }));
    const db = { storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
    const allowed = vi.fn(async () => true), path = "cache-visibility.webp";
    const first = await publishedImageResponse(new Request("https://example.test/image"), db, "check", path, allowed, false);
    expect(first.status).toBe(200); expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const request = new Request("https://example.test/image", { headers: { "if-none-match": first.headers.get("etag")! } });
    const cached = await publishedImageResponse(request, db, "check", path, allowed, false);
    expect(cached.status).toBe(304); expect(download).toHaveBeenCalledTimes(1);
    allowed.mockResolvedValue(false);
    await expect(publishedImageResponse(request, db, "check", path, allowed, false)).rejects.toThrow("NOT_FOUND");
    expect(allowed).toHaveBeenCalledTimes(3);
  });
  it("keeps staff previews out of conditional caches", async () => {
    const db = { storage: { from: () => ({ download: async () => ({ data: new Blob(["preview"]), error: null }) }) } } as unknown as SupabaseClient;
    const result = await publishedImageResponse(new Request("https://example.test/image", { headers: { "if-none-match": "*" } }), db, "check", "preview.webp", async () => true, true);
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store"); expect(result.headers.has("etag")).toBe(false);
  });
});
