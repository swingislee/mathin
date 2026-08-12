import { z } from "zod";
import { compareVoxelCoordinates, voxelCoordinateSchema } from "./voxel-schema";

export const RECTANGULAR_PRISM_MEASUREMENT_VERSION =
  "rectangular-prism-measurement-v1" as const;

export const RECTANGULAR_PRISM_MEASUREMENT_UNITS = ["unit"] as const;

export const RECTANGULAR_PRISM_MEASUREMENT_LIMITS = {
  minDimension: 1,
  maxDimension: 6,
  maxOccupiedCells: 6 * 6 * 6,
} as const;

export const RECTANGULAR_PRISM_VOLUME_FORMULA = "V=l×w×h" as const;
export const RECTANGULAR_PRISM_SURFACE_AREA_FORMULA =
  "S=2×(l×w+l×h+w×h)" as const;

const dimensionSchema = z
  .number()
  .int()
  .min(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.minDimension)
  .max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension);

export const rectangularPrismDimensionsSchema = z
  .object({
    length: dimensionSchema,
    width: dimensionSchema,
    height: dimensionSchema,
  })
  .strict();

export const rectangularPrismMeasurementRequestSchema = z
  .object({
    dimensions: rectangularPrismDimensionsSchema,
    unit: z.enum(RECTANGULAR_PRISM_MEASUREMENT_UNITS),
  })
  .strict();

export const rectangularPrismOccupiedMeasurementRequestSchema = z
  .object({
    dimensions: rectangularPrismDimensionsSchema,
    unit: z.enum(RECTANGULAR_PRISM_MEASUREMENT_UNITS),
    occupiedCells: z
      .array(voxelCoordinateSchema)
      .min(1)
      .max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxOccupiedCells),
  })
  .strict();

export const rectangularPrismCellsMeasurementRequestSchema = z
  .object({
    unit: z.enum(RECTANGULAR_PRISM_MEASUREMENT_UNITS),
    occupiedCells: z
      .array(voxelCoordinateSchema)
      .min(1)
      .max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxOccupiedCells),
  })
  .strict();

const lengthWidthFacePairSchema = z
  .object({
    pair: z.literal("length-width"),
    dimensions: z.tuple([z.literal("length"), z.literal("width")]),
    faceDirections: z.tuple([z.literal("y-"), z.literal("y+")]),
    singleFaceArea: z.number().int().min(1).max(36),
    oppositePairArea: z.number().int().min(2).max(72),
  })
  .strict();

const lengthHeightFacePairSchema = z
  .object({
    pair: z.literal("length-height"),
    dimensions: z.tuple([z.literal("length"), z.literal("height")]),
    faceDirections: z.tuple([z.literal("z-"), z.literal("z+")]),
    singleFaceArea: z.number().int().min(1).max(36),
    oppositePairArea: z.number().int().min(2).max(72),
  })
  .strict();

const widthHeightFacePairSchema = z
  .object({
    pair: z.literal("width-height"),
    dimensions: z.tuple([z.literal("width"), z.literal("height")]),
    faceDirections: z.tuple([z.literal("x-"), z.literal("x+")]),
    singleFaceArea: z.number().int().min(1).max(36),
    oppositePairArea: z.number().int().min(2).max(72),
  })
  .strict();

export const rectangularPrismMeasurementSchema = z
  .object({
    measurementVersion: z.literal(RECTANGULAR_PRISM_MEASUREMENT_VERSION),
    dimensions: rectangularPrismDimensionsSchema,
    unit: z.enum(RECTANGULAR_PRISM_MEASUREMENT_UNITS),
    axisMapping: z
      .object({
        length: z.literal("x"),
        height: z.literal("y"),
        width: z.literal("z"),
      })
      .strict(),
    occupiedCells: z
      .array(voxelCoordinateSchema)
      .min(1)
      .max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxOccupiedCells),
    volume: z
      .object({
        formula: z.literal(RECTANGULAR_PRISM_VOLUME_FORMULA),
        value: z.number().int().min(1).max(RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxOccupiedCells),
        unitExponent: z.literal(3),
      })
      .strict(),
    surfaceArea: z
      .object({
        formula: z.literal(RECTANGULAR_PRISM_SURFACE_AREA_FORMULA),
        value: z.number().int().min(6).max(216),
        unitExponent: z.literal(2),
      })
      .strict(),
    oppositeFacePairs: z.tuple([
      lengthWidthFacePairSchema,
      lengthHeightFacePairSchema,
      widthHeightFacePairSchema,
    ]),
  })
  .strict()
  .superRefine((measurement, context) => {
    const { length, width, height } = measurement.dimensions;
    const expectedVolume = length * width * height;
    const lengthWidthArea = length * width;
    const lengthHeightArea = length * height;
    const widthHeightArea = width * height;
    const expectedSurfaceArea =
      2 * (lengthWidthArea + lengthHeightArea + widthHeightArea);

    if (measurement.volume.value !== expectedVolume) {
      context.addIssue({
        code: "custom",
        message: "volume must equal length × width × height",
        path: ["volume", "value"],
      });
    }
    if (measurement.surfaceArea.value !== expectedSurfaceArea) {
      context.addIssue({
        code: "custom",
        message: "surface area must equal 2 × (length × width + length × height + width × height)",
        path: ["surfaceArea", "value"],
      });
    }

    const expectedFaceAreas = [lengthWidthArea, lengthHeightArea, widthHeightArea];
    measurement.oppositeFacePairs.forEach((pair, index) => {
      const expectedSingleArea = expectedFaceAreas[index];
      if (pair.singleFaceArea !== expectedSingleArea) {
        context.addIssue({
          code: "custom",
          message: "single face area must match its dimension pair",
          path: ["oppositeFacePairs", index, "singleFaceArea"],
        });
      }
      if (pair.oppositePairArea !== expectedSingleArea * 2) {
        context.addIssue({
          code: "custom",
          message: "opposite face-pair area must be twice the single face area",
          path: ["oppositeFacePairs", index, "oppositePairArea"],
        });
      }
    });

    if (measurement.occupiedCells.length !== expectedVolume) {
      context.addIssue({
        code: "custom",
        message: "occupied cell count must equal the rectangular-prism volume",
        path: ["occupiedCells"],
      });
    }
    measurement.occupiedCells.forEach((cell, index) => {
      if (
        cell.x < 0 ||
        cell.x >= length ||
        cell.y < 0 ||
        cell.y >= height ||
        cell.z < 0 ||
        cell.z >= width
      ) {
        context.addIssue({
          code: "custom",
          message: "occupied cell must stay inside the dimension-to-axis bounds",
          path: ["occupiedCells", index],
        });
      }
      if (
        index > 0 &&
        compareVoxelCoordinates(measurement.occupiedCells[index - 1], cell) >= 0
      ) {
        context.addIssue({
          code: "custom",
          message: "occupied cells must be unique and use canonical coordinate order",
          path: ["occupiedCells", index],
        });
      }
    });

    let index = 0;
    for (let x = 0; x < length; x += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let z = 0; z < width; z += 1) {
          const cell = measurement.occupiedCells[index];
          if (!cell || cell.x !== x || cell.y !== y || cell.z !== z) {
            context.addIssue({
              code: "custom",
              message: "occupied cells must completely fill the rectangular prism",
              path: ["occupiedCells", index],
            });
            return;
          }
          index += 1;
        }
      }
    }
  });

export type RectangularPrismDimensions = z.infer<typeof rectangularPrismDimensionsSchema>;
export type RectangularPrismMeasurementRequest = z.infer<
  typeof rectangularPrismMeasurementRequestSchema
>;
export type RectangularPrismOccupiedMeasurementRequest = z.infer<
  typeof rectangularPrismOccupiedMeasurementRequestSchema
>;
export type RectangularPrismCellsMeasurementRequest = z.infer<
  typeof rectangularPrismCellsMeasurementRequestSchema
>;
export type RectangularPrismMeasurement = z.infer<typeof rectangularPrismMeasurementSchema>;

export function parseRectangularPrismMeasurementRequest(
  input: unknown,
): RectangularPrismMeasurementRequest {
  return rectangularPrismMeasurementRequestSchema.parse(input);
}

export function parseRectangularPrismOccupiedMeasurementRequest(
  input: unknown,
): RectangularPrismOccupiedMeasurementRequest {
  return rectangularPrismOccupiedMeasurementRequestSchema.parse(input);
}

export function parseRectangularPrismCellsMeasurementRequest(
  input: unknown,
): RectangularPrismCellsMeasurementRequest {
  return rectangularPrismCellsMeasurementRequestSchema.parse(input);
}

export function parseRectangularPrismMeasurement(
  input: unknown,
): RectangularPrismMeasurement {
  return rectangularPrismMeasurementSchema.parse(input);
}
