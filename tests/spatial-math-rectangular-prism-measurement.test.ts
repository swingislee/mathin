import { describe, expect, it } from "vitest";
import {
  RECTANGULAR_PRISM_MEASUREMENT_LIMITS,
  RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES,
  RECTANGULAR_PRISM_MEASUREMENT_VERSION,
  RECTANGULAR_PRISM_SURFACE_AREA_FORMULA,
  RECTANGULAR_PRISM_VOLUME_FORMULA,
  analyzeVoxelSurfaceArea,
  buildRectangularPrismMeasurement,
  canonicalJsonStringify,
  createVoxelSet,
  measureRectangularPrismOccupiedCells,
  measureRectangularPrismCells,
  parseRectangularPrismMeasurement,
  parseRectangularPrismMeasurementRequest,
  voxelKey,
} from "@/features/spatial-math/domain";

function build(length: number, width: number, height: number) {
  return buildRectangularPrismMeasurement({
    dimensions: { length, width, height },
    unit: "unit",
  });
}

describe("rectangular-prism-measurement-v1", () => {
  it("maps length to x, height to y and width to z in canonical cell order", () => {
    const measurement = build(2, 4, 3);

    expect(measurement).toMatchObject({
      measurementVersion: RECTANGULAR_PRISM_MEASUREMENT_VERSION,
      dimensions: { length: 2, width: 4, height: 3 },
      unit: "unit",
      axisMapping: { length: "x", height: "y", width: "z" },
    });
    expect(measurement.occupiedCells).toHaveLength(24);
    expect(measurement.occupiedCells.slice(0, 5).map(voxelKey)).toEqual([
      "0,0,0",
      "0,0,1",
      "0,0,2",
      "0,0,3",
      "0,1,0",
    ]);
    expect(measurement.occupiedCells.at(-1)).toEqual({ x: 1, y: 2, z: 3 });
    expect(createVoxelSet(measurement.occupiedCells).bounds).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 2,
      minZ: 0,
      maxZ: 3,
    });
  });

  it("returns exact volume, surface-area formulas and the three opposite-face pairs", () => {
    const measurement = build(2, 4, 3);

    expect(measurement.volume).toEqual({
      formula: RECTANGULAR_PRISM_VOLUME_FORMULA,
      value: 24,
      unitExponent: 3,
    });
    expect(measurement.surfaceArea).toEqual({
      formula: RECTANGULAR_PRISM_SURFACE_AREA_FORMULA,
      value: 52,
      unitExponent: 2,
    });
    expect(measurement.oppositeFacePairs).toEqual([
      {
        pair: "length-width",
        dimensions: ["length", "width"],
        faceDirections: ["y-", "y+"],
        singleFaceArea: 8,
        oppositePairArea: 16,
      },
      {
        pair: "length-height",
        dimensions: ["length", "height"],
        faceDirections: ["z-", "z+"],
        singleFaceArea: 6,
        oppositePairArea: 12,
      },
      {
        pair: "width-height",
        dimensions: ["width", "height"],
        faceDirections: ["x-", "x+"],
        singleFaceArea: 12,
        oppositePairArea: 24,
      },
    ]);
    expect(
      measurement.oppositeFacePairs.reduce(
        (total, pair) => total + pair.oppositePairArea,
        0,
      ),
    ).toBe(measurement.surfaceArea.value);
  });

  it("matches the independent voxel surface oracle for every accepted dimension triple", () => {
    for (
      let length = RECTANGULAR_PRISM_MEASUREMENT_LIMITS.minDimension;
      length <= RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension;
      length += 1
    ) {
      for (
        let width = RECTANGULAR_PRISM_MEASUREMENT_LIMITS.minDimension;
        width <= RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension;
        width += 1
      ) {
        for (
          let height = RECTANGULAR_PRISM_MEASUREMENT_LIMITS.minDimension;
          height <= RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension;
          height += 1
        ) {
          const measurement = build(length, width, height);
          const voxels = createVoxelSet(measurement.occupiedCells);
          const surface = analyzeVoxelSurfaceArea(voxels);

          expect(measurement.volume.value).toBe(voxels.size);
          expect(measurement.surfaceArea.value).toBe(surface.totalUnitFaces);
          expect(surface.exteriorUnitFaces).toBe(surface.totalUnitFaces);
          expect(surface.interiorUnitFaces).toBe(0);
        }
      }
    }
  });

  it("remeasures the actual canonical occupied set and rejects missing or irregular voxels", () => {
    const generated = build(2, 4, 3);
    expect(
      measureRectangularPrismOccupiedCells({
        dimensions: generated.dimensions,
        unit: generated.unit,
        occupiedCells: generated.occupiedCells,
      }),
    ).toEqual(generated);

    expect(() =>
      measureRectangularPrismOccupiedCells({
        dimensions: generated.dimensions,
        unit: generated.unit,
        occupiedCells: generated.occupiedCells.slice(0, -1),
      }),
    ).toThrow(/volume|cell count|completely fill/);

    const irregular = structuredClone(generated.occupiedCells);
    irregular[irregular.length - 1] = { x: 2, y: 2, z: 3 };
    expect(() =>
      measureRectangularPrismOccupiedCells({
        dimensions: generated.dimensions,
        unit: generated.unit,
        occupiedCells: irregular,
      }),
    ).toThrow(/bounds|completely fill|volume/);

    expect(() =>
      measureRectangularPrismOccupiedCells({
        dimensions: generated.dimensions,
        unit: generated.unit,
        occupiedCells: [...generated.occupiedCells].reverse(),
      }),
    ).toThrow(/canonical|completely fill/);
  });

  it("infers 4 × 3 × 2 from actual cells without trusting external dimensions", () => {
    const generated = build(4, 3, 2);
    const inferred = measureRectangularPrismCells({
      unit: "unit",
      occupiedCells: generated.occupiedCells,
    });

    expect(inferred).toEqual(generated);
    expect(inferred.dimensions).toEqual({ length: 4, width: 3, height: 2 });
    expect(inferred.axisMapping).toEqual({ length: "x", height: "y", width: "z" });
    expect(inferred.volume.value).toBe(24);
    expect(inferred.surfaceArea.value).toBe(52);
  });

  it("fails inferred measurement with stable errors for malformed prism geometry", () => {
    const generated = build(3, 3, 3);
    const expectCode = (occupiedCells: typeof generated.occupiedCells, code: string) => {
      try {
        measureRectangularPrismCells({ unit: "unit", occupiedCells });
        throw new Error("expected rectangular-prism measurement to fail");
      } catch (error) {
        expect(error).toMatchObject({ name: "RectangularPrismMeasurementError", code });
      }
    };

    expectCode(
      generated.occupiedCells.map((cell) => ({ x: cell.x + 1, y: cell.y, z: cell.z })),
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.originRequired,
    );
    expectCode(
      generated.occupiedCells.filter((cell) => !(cell.x === 1 && cell.y === 1 && cell.z === 1)),
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.notSolidPrism,
    );
    expectCode(
      [...generated.occupiedCells].reverse(),
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.nonCanonicalCells,
    );
    expectCode(
      Array.from({ length: 7 }, (_, x) => ({ x, y: 0, z: 0 })),
      RECTANGULAR_PRISM_MEASUREMENT_ERROR_CODES.dimensionLimit,
    );
  });

  it("accepts the 1 and 6 dimension boundaries", () => {
    const unitCube = build(1, 1, 1);
    expect(unitCube.occupiedCells).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(unitCube.volume.value).toBe(1);
    expect(unitCube.surfaceArea.value).toBe(6);
    expect(unitCube.oppositeFacePairs.map((pair) => pair.oppositePairArea)).toEqual([2, 2, 2]);

    const maximum = build(6, 6, 6);
    expect(maximum.occupiedCells).toHaveLength(
      RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxOccupiedCells,
    );
    expect(maximum.volume.value).toBe(216);
    expect(maximum.surfaceArea.value).toBe(216);
    expect(maximum.occupiedCells.at(-1)).toEqual({ x: 5, y: 5, z: 5 });
  });

  it("is deterministic and does not mutate the request", () => {
    const request = {
      dimensions: { length: 3, width: 2, height: 5 },
      unit: "unit" as const,
    };
    const before = canonicalJsonStringify(request);
    const first = buildRectangularPrismMeasurement(request);
    const second = buildRectangularPrismMeasurement({
      unit: request.unit,
      dimensions: {
        height: request.dimensions.height,
        width: request.dimensions.width,
        length: request.dimensions.length,
      },
    });

    expect(canonicalJsonStringify(request)).toBe(before);
    expect(second).toEqual(first);
    expect(canonicalJsonStringify(second)).toBe(canonicalJsonStringify(first));
  });

  it("strictly rejects unsupported dimensions, units and injected fields", () => {
    for (const dimensions of [
      { length: 0, width: 1, height: 1 },
      { length: 7, width: 1, height: 1 },
      { length: 1.5, width: 1, height: 1 },
      { length: Number.NaN, width: 1, height: 1 },
    ]) {
      expect(() =>
        parseRectangularPrismMeasurementRequest({ dimensions, unit: "unit" }),
      ).toThrow();
    }
    expect(() =>
      parseRectangularPrismMeasurementRequest({
        dimensions: { length: 1, width: 1, height: 1 },
        unit: "cm",
      }),
    ).toThrow();
    expect(() =>
      parseRectangularPrismMeasurementRequest({
        dimensions: { length: 1, width: 1, height: 1, depth: 1 },
        unit: "unit",
      }),
    ).toThrow();
    expect(() =>
      parseRectangularPrismMeasurementRequest({
        dimensions: { length: 1, width: 1, height: 1 },
        unit: "unit",
        locale: "zh",
      }),
    ).toThrow();
  });

  it("rejects drift in every derived measurement authority", () => {
    const valid = build(2, 4, 3);
    const wrongVolume = structuredClone(valid);
    wrongVolume.volume.value += 1;
    expect(() => parseRectangularPrismMeasurement(wrongVolume)).toThrow(/volume must equal/);

    const wrongSurface = structuredClone(valid);
    wrongSurface.surfaceArea.value -= 2;
    expect(() => parseRectangularPrismMeasurement(wrongSurface)).toThrow(/surface area must equal/);

    const wrongPair = structuredClone(valid);
    wrongPair.oppositeFacePairs[1].singleFaceArea += 1;
    expect(() => parseRectangularPrismMeasurement(wrongPair)).toThrow(/single face area/);

    const missingCell = structuredClone(valid);
    missingCell.occupiedCells.pop();
    expect(() => parseRectangularPrismMeasurement(missingCell)).toThrow(/cell count|completely fill/);

    const reorderedCells = structuredClone(valid);
    [reorderedCells.occupiedCells[0], reorderedCells.occupiedCells[1]] = [
      reorderedCells.occupiedCells[1],
      reorderedCells.occupiedCells[0],
    ];
    expect(() => parseRectangularPrismMeasurement(reorderedCells)).toThrow(/canonical|completely fill/);

    expect(() => parseRectangularPrismMeasurement({ ...valid, displayLabel: "长方体" })).toThrow();
  });
});
