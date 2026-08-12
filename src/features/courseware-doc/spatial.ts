import type { SpatialPageDoc } from "@/features/spatial-math/domain/page-schema";

/** Lightweight docVersion guard; safe for client dispatch without importing the spatial zod graph. */
export function isSpatialPageDoc(doc: { readonly docVersion: string }): doc is SpatialPageDoc {
  return doc.docVersion === "spatial-page-v1";
}
