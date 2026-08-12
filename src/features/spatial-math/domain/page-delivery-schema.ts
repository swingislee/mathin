import { z } from "zod";
import { spatialPageDocSchema } from "./page-schema";

export const SPATIAL_PAGE_DELIVERY_VERSION = "spatial-page-delivery-v1" as const;
export const SPATIAL_PLATFORM_TRACKS = ["native-16x9", "adapted-4x3"] as const;
export const SPATIAL_PAGE_DELIVERY_MODES = [
  "shared-standard-4x3",
  "wide-16x9-exception",
] as const;

const revisionSchema = z
  .object({
    revisionId: z.string().uuid(),
    revisionNo: z.number().int().positive(),
    page: spatialPageDocSchema,
  })
  .strict();

export const spatialPageDeliveryRequestSchema = z
  .object({
    deliveryVersion: z.literal(SPATIAL_PAGE_DELIVERY_VERSION),
    pageDocId: z.string().uuid(),
    standard: revisionSchema,
    wide: revisionSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.standard.page.layout.profile !== "standard-4x3") {
      context.addIssue({
        code: "custom",
        message: "standard revision must use standard-4x3",
        path: ["standard", "page", "layout", "profile"],
      });
    }
    if (!request.wide) return;
    if (request.wide.page.layout.profile !== "wide-16x9-exception") {
      context.addIssue({
        code: "custom",
        message: "wide revision must use wide-16x9-exception",
        path: ["wide", "page", "layout", "profile"],
      });
    }
    if (request.wide.revisionId === request.standard.revisionId) {
      context.addIssue({
        code: "custom",
        message: "wide exception must use a distinct revision id",
        path: ["wide", "revisionId"],
      });
    }
    if (request.wide.revisionNo === request.standard.revisionNo) {
      context.addIssue({
        code: "custom",
        message: "wide exception must use a distinct revision number",
        path: ["wide", "revisionNo"],
      });
    }
  });

const deliveryHeadSchema = z
  .object({
    track: z.enum(SPATIAL_PLATFORM_TRACKS),
    revisionId: z.string().uuid(),
    revisionNo: z.number().int().positive(),
    layoutProfile: z.enum(["standard-4x3", "wide-16x9-exception"]),
  })
  .strict();

export const spatialPageDeliveryPlanSchema = z
  .object({
    deliveryVersion: z.literal(SPATIAL_PAGE_DELIVERY_VERSION),
    pageDocId: z.string().uuid(),
    docVersion: z.literal("spatial-page-v1"),
    sceneHash: z.string().regex(/^[0-9a-f]{64}$/),
    mode: z.enum(SPATIAL_PAGE_DELIVERY_MODES),
    atomic: z.literal(true),
    heads: z.tuple([deliveryHeadSchema, deliveryHeadSchema]),
  })
  .strict()
  .superRefine((plan, context) => {
    const [native, adapted] = plan.heads;
    if (native.track !== "native-16x9" || adapted.track !== "adapted-4x3") {
      context.addIssue({ code: "custom", message: "delivery heads must use stable track order", path: ["heads"] });
    }
    if (adapted.layoutProfile !== "standard-4x3") {
      context.addIssue({
        code: "custom",
        message: "adapted head must always reference standard-4x3",
        path: ["heads", 1, "layoutProfile"],
      });
    }
    if (plan.mode === "shared-standard-4x3") {
      if (native.layoutProfile !== "standard-4x3") {
        context.addIssue({
          code: "custom",
          message: "shared delivery must keep the native compatibility head on standard-4x3",
          path: ["heads", 0, "layoutProfile"],
        });
      }
      if (native.revisionId !== adapted.revisionId || native.revisionNo !== adapted.revisionNo) {
        context.addIssue({
          code: "custom",
          message: "shared delivery heads must reference the same revision",
          path: ["heads"],
        });
      }
    } else {
      if (native.layoutProfile !== "wide-16x9-exception") {
        context.addIssue({
          code: "custom",
          message: "wide exception delivery must map native to wide-16x9-exception",
          path: ["heads", 0, "layoutProfile"],
        });
      }
      if (native.revisionId === adapted.revisionId || native.revisionNo === adapted.revisionNo) {
        context.addIssue({
          code: "custom",
          message: "wide exception delivery must use distinct revisions",
          path: ["heads"],
        });
      }
    }
  });

export type SpatialPageDeliveryRequest = z.infer<typeof spatialPageDeliveryRequestSchema>;
export type SpatialPageDeliveryPlan = z.infer<typeof spatialPageDeliveryPlanSchema>;

export function parseSpatialPageDeliveryRequest(input: unknown): SpatialPageDeliveryRequest {
  return spatialPageDeliveryRequestSchema.parse(input);
}

export function parseSpatialPageDeliveryPlan(input: unknown): SpatialPageDeliveryPlan {
  return spatialPageDeliveryPlanSchema.parse(input);
}
