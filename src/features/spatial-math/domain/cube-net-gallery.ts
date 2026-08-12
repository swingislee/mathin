import {
  CUBE_NET_ANALYSIS_REASONS,
  analyzeCubeNet,
  enumerateFreePolyominoes,
  unitSquareNetCanonicalKey,
} from "./cube-net-kernel";
import {
  CUBE_NET_GALLERY_VERSION,
  cubeNetGalleryEvaluationSchema,
  parseCubeNetGalleryCatalog,
  parseCubeNetGalleryPrediction,
  type CubeNetGalleryCatalog,
  type CubeNetGalleryEntry,
  type CubeNetGalleryEvaluation,
} from "./cube-net-gallery-schema";

function ordinal(value: number): string {
  return String(value).padStart(2, "0");
}

export function createCubeNetGalleryCatalog(): CubeNetGalleryCatalog {
  let legalOrdinal = 0;
  let invalidOrdinal = 0;
  const entries = enumerateFreePolyominoes(6).map((net, index): CubeNetGalleryEntry => {
    const analysis = analyzeCubeNet(net);
    if (
      analysis.reason !== CUBE_NET_ANALYSIS_REASONS.valid &&
      analysis.reason !== CUBE_NET_ANALYSIS_REASONS.orientationConflict &&
      analysis.reason !== CUBE_NET_ANALYSIS_REASONS.faceOverlap
    ) {
      throw new Error(`free hexomino enumeration produced an unsupported gallery reason: ${analysis.reason}`);
    }
    const classification = analysis.isCubeNet ? "legal" : "invalid";
    const classificationOrdinal = analysis.isCubeNet ? ++legalOrdinal : ++invalidOrdinal;
    return {
      id: `cube-net-gallery.${ordinal(index + 1)}`,
      catalogOrdinal: index + 1,
      classificationOrdinal,
      canonicalKey: unitSquareNetCanonicalKey(net),
      classification,
      reason: analysis.reason,
      adjacencyEdgeCount: analysis.adjacencyEdgeCount,
      net,
    };
  });
  return parseCubeNetGalleryCatalog({ galleryVersion: CUBE_NET_GALLERY_VERSION, entries });
}

export function cubeNetGalleryJudgmentDeck(catalogInput: unknown): readonly CubeNetGalleryEntry[] {
  const catalog = parseCubeNetGalleryCatalog(catalogInput);
  const legal = catalog.entries.filter((entry) => entry.classification === "legal");
  const invalid = catalog.entries.filter((entry) => entry.classification === "invalid");
  return Array.from({ length: invalid.length }, (_, index) => [legal[index], invalid[index]])
    .flat()
    .filter((entry): entry is CubeNetGalleryEntry => Boolean(entry));
}

export function evaluateCubeNetGalleryPrediction(
  catalogInput: unknown,
  predictionInput: unknown,
): CubeNetGalleryEvaluation {
  const catalog = parseCubeNetGalleryCatalog(catalogInput);
  const prediction = parseCubeNetGalleryPrediction(predictionInput);
  const entry = catalog.entries.find((candidate) => candidate.id === prediction.entryId);
  if (!entry) throw new RangeError(`unknown cube net gallery entry: ${prediction.entryId}`);
  return cubeNetGalleryEvaluationSchema.parse({
    ...prediction,
    actual: entry.classification,
    correct: prediction.prediction === entry.classification,
    reason: entry.reason,
  });
}

export function cubeNetGalleryReasonIsGeometricFailure(entry: CubeNetGalleryEntry): boolean {
  return entry.reason === CUBE_NET_ANALYSIS_REASONS.orientationConflict ||
    entry.reason === CUBE_NET_ANALYSIS_REASONS.faceOverlap;
}
