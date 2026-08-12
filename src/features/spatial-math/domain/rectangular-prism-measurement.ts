import {
  RECTANGULAR_PRISM_MEASUREMENT_VERSION,
  RECTANGULAR_PRISM_MEASUREMENT_LIMITS,
  RECTANGULAR_PRISM_SURFACE_AREA_FORMULA,
  RECTANGULAR_PRISM_VOLUME_FORMULA,
  parseRectangularPrismMeasurement,
  parseRectangularPrismCellsMeasurementRequest,
  parseRectangularPrismOccupiedMeasurementRequest,
  parseRectangularPrismMeasurementRequest,
  type RectangularPrismDimensions,
  type RectangularPrismMeasurement,
} from "./rectangular-prism-measurement-schema";
import { analyzeVoxelSurfaceArea } from "./voxel-kernel";
import { compareVoxelCoordinates, createVoxelSet } from "./voxel-schema";
import type { VoxelCoordinate } from "./voxel-types";

export const RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES = {
  originRequired: "RECTANGULAR_PRISM_ORIGIN_REQUIRED",
  dimensionLimit: "RECTANGULAR_PRISM_DIMENSION_LIMIT",
  nonCanonicalCells: "RECTANGULAR_PRISM_NON_CANONICAL_CELLS",
  notSolidPrism: "RECTANGULAR_PRISM_NOT_SOLID_PRISM",
} as const;

export type RectangularPrismMeasurementErrorCode =
  (typeof RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES)[keyof typeof RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES];

export class RectangularPrismMeasurementError extends Error {
  constructor(
    public readonly code: RectangularPrismMeasurementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RectangularPrismMeasurementError";
  }
}

function occupiedCells(
  length: number,
  width: number,
  height: number,
): VoxelCoordinate[] {
  const cells: VoxelCoordinate[] = [];
  // compareVoxelCoordinates orders x, then y, then z. These loops therefore
  // emit the canonical order without a second renderer-specific transform.
  for (let x = 0; x < length; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < width; z += 1) cells.push({ x, y, z });
    }
  }
  return cells;
}

export function buildRectangularPrismMeasurement(
  input: unknown,
): RectangularPrismMeasurement {
  const request = parseRectangularPrismMeasurementRequest(input);
  return materializeMeasurement(
    request.dimensions,
    request.unit,
    occupiedCells(
      request.dimensions.length,
      request.dimensions.width,
      request.dimensions.height,
    ),
  );
}

/**
 * Measures an actual authored voxel set. The full measurement parser verifies
 * that the cells are canonical and completely fill the declared axis-aligned
 * prism; dimensions never override a missing or irregular voxel.
 */
export function measureRectangularPrismOccupiedCells(
  input: unknown,
): RectangularPrismMeasurement {
  const request = parseRectangularPrismOccupiedMeasurementRequest(input);
  return materializeMeasurement(request.dimensions, request.unit, request.occupiedCells);
}

/** Infers dimensions from an actual origin-aligned, completely filled voxel set. */
export function measureRectangularPrismCells(input: unknown): RectangularPrismMeasurement {
  const request = parseRectangularPrismCellsMeasurementRequest(input);
  for (let index = 1; index < request.occupiedCells.length; index += 1) {
    if (compareVoxelCoordinates(request.occupiedCells[index - 1], request.occupiedCells[index]) >= 0) {
      throw new RectangularPrismMeasurementError(
        RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.nonCanonicalCells,
        "rectangular prism occupied cells must be unique and use canonical coordinate order",
      );
    }
  }

  const voxels = createVoxelSet(request.occupiedCells);
  const bounds = voxels.bounds;
  if (!bounds) {
    // The request schema requires at least one cell; retain a fail-closed guard
    // should that source contract ever be widened independently.
    throw new RectangularPrismMeasurementError(
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.notSolidPrism,
      "rectangular prism occupied cells must not be empty",
    );
  }
  if (bounds.minX !== 0 || bounds.minY !== 0 || bounds.minZ !== 0) {
    throw new RectangularPrismMeasurementError(
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.originRequired,
      "rectangular prism occupied cells must start at the canonical origin",
    );
  }
  const dimensions = {
    length: bounds.maxX + 1,
    height: bounds.maxY + 1,
    width: bounds.maxZ + 1,
  };
  if (
    dimensions.length > RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension ||
    dimensions.width > RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension ||
    dimensions.height > RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension
  ) {
    throw new RectangularPrismMeasurementError(
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.dimensionLimit,
      `rectangular prism dimensions must not exceed ${RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension}`,
    );
  }
  if (voxels.size !== dimensions.length * dimensions.width * dimensions.height) {
    throw new RectangularPrismMeasurementError(
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.notSolidPrism,
      "occupied cells do not form a completely filled axis-aligned rectangular prism",
    );
  }

  return materializeMeasurement(dimensions, request.unit, request.occupiedCells);
}

function materializeMeasurement(
  dimensions: RectangularPrismDimensions,
  unit: "unit",
  cells: readonly VoxelCoordinate[],
): RectangularPrismMeasurement {
  const { length, width, height } = dimensions;
  const lengthWidthArea = length * width;
  const lengthHeightArea = length * height;
  const widthHeightArea = width * height;
  const voxels = createVoxelSet(cells);
  const voxelSurface = analyzeVoxelSurfaceArea(voxels);
  if (
    voxelSurface.totalUnitFaces !== voxelSurface.exteriorUnitFaces ||
    voxelSurface.interiorUnitFaces !== 0
  ) {
    throw new RangeError("rectangular prism occupied cells must have only exterior surface area");
  }

  return parseRectangularPrismMeasurement({
    measurementVersion: RECTANGULAR_PRISM_MEASUREMENT_VERSION,
    dimensions,
    unit,
    axisMapping: { length: "x", height: "y", width: "z" },
    occupiedCells: cells,
    volume: {
      formula: RECTANGULAR_PRISM_VOLUME_FORMULA,
      value: voxels.size,
      unitExponent: 3,
    },
    surfaceArea: {
      formula: RECTANGULAR_PRISM_SURFACE_AREA_FORMULA,
      value: voxelSurface.exteriorUnitFaces,
      unitExponent: 2,
    },
    oppositeFacePairs: [
      {
        pair: "length-width",
        dimensions: ["length", "width"],
        faceDirections: ["y-", "y+"],
        singleFaceArea: lengthWidthArea,
        oppositePairArea: lengthWidthArea * 2,
      },
      {
        pair: "length-height",
        dimensions: ["length", "height"],
        faceDirections: ["z-", "z+"],
        singleFaceArea: lengthHeightArea,
        oppositePairArea: lengthHeightArea * 2,
      },
      {
        pair: "width-height",
        dimensions: ["width", "height"],
        faceDirections: ["x-", "x+"],
        singleFaceArea: widthHeightArea,
        oppositePairArea: widthHeightArea * 2,
      },
    ],
  });
}
