import { describe, expect, it } from "vitest";
import {
  SPATIAL_PAGE_DELIVERY_VERSION,
  buildSpatialPageDeliveryPlan,
  canonicalSha256,
  parseSpatialPageDeliveryPlan,
  parseSpatialPageDeliveryRequest,
} from "@/features/spatial-math/domain";
import {
  validStandardSpatialPage,
  wideSpatialPageFrom,
} from "./fixtures/spatial-page";

const PAGE_DOC_ID = "00000000-0000-4000-8000-000000000101";
const STANDARD_REVISION_ID = "00000000-0000-4000-8000-000000000102";
const WIDE_REVISION_ID = "00000000-0000-4000-8000-000000000103";

async function request() {
  return {
    deliveryVersion: SPATIAL_PAGE_DELIVERY_VERSION,
    pageDocId: PAGE_DOC_ID,
    standard: {
      revisionId: STANDARD_REVISION_ID,
      revisionNo: 7,
      page: await validStandardSpatialPage(),
    },
  } as const;
}

describe("spatial-page-delivery-v1", () => {
  it("strictly parses the versioned delivery request", async () => {
    const value = await request();

    expect(parseSpatialPageDeliveryRequest(value)).toEqual(value);
    expect(() => parseSpatialPageDeliveryRequest({ ...value, deliveryVersion: "spatial-page-delivery-v2" })).toThrow();
    expect(() => parseSpatialPageDeliveryRequest({ ...value, track: "native-16x9" })).toThrow();
  });

  it("maps both compatibility heads to one standard 4:3 revision by default", async () => {
    const plan = await buildSpatialPageDeliveryPlan(await request());

    expect(plan).toMatchObject({
      deliveryVersion: SPATIAL_PAGE_DELIVERY_VERSION,
      pageDocId: PAGE_DOC_ID,
      docVersion: "spatial-page-v1",
      mode: "shared-standard-4x3",
      atomic: true,
      heads: [
        {
          track: "native-16x9",
          revisionId: STANDARD_REVISION_ID,
          revisionNo: 7,
          layoutProfile: "standard-4x3",
        },
        {
          track: "adapted-4x3",
          revisionId: STANDARD_REVISION_ID,
          revisionNo: 7,
          layoutProfile: "standard-4x3",
        },
      ],
    });
  });

  it("maps only the native compatibility head to an explicit wide exception", async () => {
    const value = await request();
    const wide = wideSpatialPageFrom(value.standard.page);
    const plan = await buildSpatialPageDeliveryPlan({
      ...value,
      wide: { revisionId: WIDE_REVISION_ID, revisionNo: 8, page: wide },
    });

    expect(plan.mode).toBe("wide-16x9-exception");
    expect(plan.heads).toEqual([
      {
        track: "native-16x9",
        revisionId: WIDE_REVISION_ID,
        revisionNo: 8,
        layoutProfile: "wide-16x9-exception",
      },
      {
        track: "adapted-4x3",
        revisionId: STANDARD_REVISION_ID,
        revisionNo: 7,
        layoutProfile: "standard-4x3",
      },
    ]);
  });

  it("produces deterministic plans and canonical hashes", async () => {
    const value = await request();
    const first = await buildSpatialPageDeliveryPlan(value);
    const second = await buildSpatialPageDeliveryPlan(structuredClone(value));

    expect(second).toEqual(first);
    expect(await canonicalSha256(second)).toBe(await canonicalSha256(first));
  });

  it("rejects a forged scene hash before producing a head plan", async () => {
    const value = await request();
    value.standard.page.sceneHash = "0".repeat(64);

    await expect(buildSpatialPageDeliveryPlan(value)).rejects.toMatchObject({
      code: "SPATIAL_PAGE_SCENE_HASH_MISMATCH",
    });
  });

  it("rejects semantic drift between standard and wide revisions", async () => {
    const value = await request();
    const wide = wideSpatialPageFrom(value.standard.page);
    wide.classroom.cameraSync = "bookmark-only";

    await expect(buildSpatialPageDeliveryPlan({
      ...value,
      wide: { revisionId: WIDE_REVISION_ID, revisionNo: 8, page: wide },
    })).rejects.toMatchObject({ code: "SPATIAL_PAGE_LAYOUT_SET_MISMATCH" });
  });

  it("rejects revision identity reuse for a wide exception", async () => {
    const value = await request();
    const wide = wideSpatialPageFrom(value.standard.page);

    expect(() => parseSpatialPageDeliveryRequest({
      ...value,
      wide: { revisionId: STANDARD_REVISION_ID, revisionNo: 7, page: wide },
    })).toThrow();
  });

  it("fails closed for non-atomic, reversed or internally inconsistent plans", async () => {
    const plan = await buildSpatialPageDeliveryPlan(await request());

    expect(() => parseSpatialPageDeliveryPlan({ ...plan, atomic: false })).toThrow();
    expect(() => parseSpatialPageDeliveryPlan({ ...plan, heads: [...plan.heads].reverse() })).toThrow();
    expect(() => parseSpatialPageDeliveryPlan({
      ...plan,
      heads: [plan.heads[0], { ...plan.heads[1], revisionId: WIDE_REVISION_ID }],
    })).toThrow();
  });
});
