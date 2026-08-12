import { describe, expect, it } from "vitest";
import {
  CUBE_NET_ANALYSIS_REASONS,
  CUBE_NET_GALLERY_LIMITS,
  CUBE_NET_GALLERY_VERSION,
  cubeNetGalleryJudgmentDeck,
  createCubeNetGalleryCatalog,
  evaluateCubeNetGalleryPrediction,
  parseCubeNetGalleryCatalog,
  parseCubeNetGalleryPrediction,
} from "@/features/spatial-math/domain";
import { CUBE_NET_GOLD_CANONICAL_KEYS } from "@/features/spatial-math/gold";

describe("cube-net-gallery-v1", () => {
  it("partitions all 35 free hexominoes into the exact 11 gold nets and 24 invalid shapes", () => {
    const catalog = createCubeNetGalleryCatalog();
    const legal = catalog.entries.filter((entry) => entry.classification === "legal");
    const invalid = catalog.entries.filter((entry) => entry.classification === "invalid");

    expect(catalog.galleryVersion).toBe(CUBE_NET_GALLERY_VERSION);
    expect(catalog.entries).toHaveLength(CUBE_NET_GALLERY_LIMITS.entryCount);
    expect(legal).toHaveLength(CUBE_NET_GALLERY_LIMITS.legalCount);
    expect(invalid).toHaveLength(CUBE_NET_GALLERY_LIMITS.invalidCount);
    expect(legal.map((entry) => entry.canonicalKey)).toEqual(CUBE_NET_GOLD_CANONICAL_KEYS);
    expect(new Set(invalid.map((entry) => entry.reason))).toEqual(
      new Set([CUBE_NET_ANALYSIS_REASONS.orientationConflict, CUBE_NET_ANALYSIS_REASONS.faceOverlap]),
    );
  });

  it("uses stable ids, canonical order, contiguous partition ordinals and unique cells", () => {
    const catalog = createCubeNetGalleryCatalog();
    expect(catalog.entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: 35 }, (_, index) => `cube-net-gallery.${String(index + 1).padStart(2, "0")}`),
    );
    expect(catalog.entries.map((entry) => entry.catalogOrdinal)).toEqual(
      Array.from({ length: 35 }, (_, index) => index + 1),
    );
    expect(catalog.entries.map((entry) => entry.canonicalKey)).toEqual(
      [...catalog.entries.map((entry) => entry.canonicalKey)].sort(),
    );
    expect(new Set(catalog.entries.map((entry) => JSON.stringify(entry.net.cells))).size).toBe(35);
    expect(catalog.entries.filter((entry) => entry.classification === "legal").map((entry) => entry.classificationOrdinal))
      .toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    expect(catalog.entries.filter((entry) => entry.classification === "invalid").map((entry) => entry.classificationOrdinal))
      .toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
  });

  it("is byte-for-byte deterministic and fails closed on injected or reordered content", () => {
    const first = createCubeNetGalleryCatalog();
    const second = createCubeNetGalleryCatalog();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(() => parseCubeNetGalleryCatalog({ ...first, unexpected: true })).toThrow();
    expect(() => parseCubeNetGalleryCatalog({ ...first, entries: [...first.entries].reverse() })).toThrow();
    expect(() => parseCubeNetGalleryCatalog({ ...first, entries: first.entries.slice(1) })).toThrow();
    expect(() => parseCubeNetGalleryCatalog({
      ...first,
      entries: first.entries.map((entry, index) => index === 0 ? { ...entry, canonicalKey: first.entries[1].canonicalKey } : entry),
    })).toThrow();
  });

  it("creates a deterministic mixed judgment deck without changing catalog entries", () => {
    const catalog = createCubeNetGalleryCatalog();
    const deck = cubeNetGalleryJudgmentDeck(catalog);
    expect(deck).toHaveLength(35);
    expect(new Set(deck.map((entry) => entry.id)).size).toBe(35);
    expect(deck.slice(0, 22).map((entry) => entry.classification)).toEqual(
      Array.from({ length: 11 }, () => ["legal", "invalid"] as const).flat(),
    );
    expect(cubeNetGalleryJudgmentDeck(catalog).map((entry) => entry.id)).toEqual(deck.map((entry) => entry.id));
  });

  it("evaluates local legal/invalid predictions with the pinned kernel reason", () => {
    const catalog = createCubeNetGalleryCatalog();
    const [legal, invalid] = cubeNetGalleryJudgmentDeck(catalog);
    const correct = evaluateCubeNetGalleryPrediction(catalog, {
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: legal.id,
      prediction: "legal",
    });
    const incorrect = evaluateCubeNetGalleryPrediction(catalog, {
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: invalid.id,
      prediction: "legal",
    });
    expect(correct).toMatchObject({ actual: "legal", correct: true, reason: CUBE_NET_ANALYSIS_REASONS.valid });
    expect(incorrect).toMatchObject({ actual: "invalid", correct: false });
    expect(incorrect.reason).not.toBe(CUBE_NET_ANALYSIS_REASONS.valid);
  });

  it("rejects unknown entries, malformed predictions and catalog/prediction version drift", () => {
    const catalog = createCubeNetGalleryCatalog();
    expect(() => parseCubeNetGalleryPrediction({
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: "cube-net-gallery.01",
      prediction: "maybe",
    })).toThrow();
    expect(() => evaluateCubeNetGalleryPrediction(catalog, {
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: "cube-net-gallery.99",
      prediction: "invalid",
    })).toThrow(RangeError);
    expect(() => evaluateCubeNetGalleryPrediction(catalog, {
      galleryVersion: "cube-net-gallery-v2",
      entryId: "cube-net-gallery.01",
      prediction: "legal",
    })).toThrow();
  });
});
